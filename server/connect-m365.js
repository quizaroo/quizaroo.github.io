// flashcards-admin connect-m365 <mailbox>: sets up sending through Microsoft 365. An admin signs in with a code at microsoft.com/devicelogin.
//   1) Microsoft Graph creates an app holding only this server's public certificate (no secret, no Graph permissions).
//   2) Exchange creates the mailbox if it's missing (a shared mailbox, so no licence) and lets the app send as that one mailbox only (RBAC for Applications).
// The admin sign-ins are used for these few calls and never stored. Deleting the app in Entra stops all sending at once.
// Safe to run again: it picks up from what's already done.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const DATA_DIR = process.env.DATA_DIR || '/var/lib/open-flashcards';
const MAIL_DIR = path.join(DATA_DIR, 'mail');
const LOGIN = process.env.GRAPH_LOGIN_URL || 'https://login.microsoftonline.com';
const GRAPH = process.env.GRAPH_URL || 'https://graph.microsoft.com';
const EXCHANGE = process.env.EXCHANGE_URL || 'https://outlook.office365.com';
const APP_NAME = 'Open Flashcards sign-up mail';
// Microsoft's own public clients for signing in from a command line.
const GRAPH_SIGN_IN = { client: '14d82eec-204b-4c2f-b7e8-296a70dab67e', scope: 'https://graph.microsoft.com/Application.ReadWrite.All' };
const EXCHANGE_SIGN_IN = { client: 'fb78d390-0c51-40cd-8e17-fdbfab77341b', scope: 'https://outlook.office365.com/.default' };

const wait = ms => new Promise(done => setTimeout(done, ms));
const claimsOf = token => JSON.parse(Buffer.from(token.split('.')[1], 'base64url'));
const say = text => console.log(text);
const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
const writeJson = (file, data) => { fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(data, null, 1)}\n`, { mode: 0o600 }); fs.renameSync(`${file}.tmp`, file); };
const notFound = failure => /couldn.t be found|not found|couldn.t find|doesn.t exist/i.test(failure.message);
const alreadyThere = failure => { if (!/already exist|already being used|already used|already has/i.test(failure.message)) throw failure; };
async function whenFound(step) { for (let attempt = 1; ; attempt++) { try { return await step(); } catch (failure) { if (attempt === 9 || !notFound(failure)) throw failure; await wait(15000); } } }

async function postForm(url, form) {
  const response = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(20000), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form) });
  return response.json().catch(() => ({}));
}

async function deviceSignIn(signIn, tenant, stepText) {
  const started = await postForm(`${LOGIN}/${tenant}/oauth2/v2.0/devicecode`, { client_id: signIn.client, scope: signIn.scope });
  if (!started.device_code) throw new Error(`Microsoft didn't give a sign-in code: ${String(started.error_description || started.error || 'no answer').split('\r')[0]}`);
  say(`\n${stepText}: go to ${started.verification_uri || 'https://microsoft.com/devicelogin'} and enter ${started.user_code}, signing in as a Microsoft 365 administrator.`);
  const expires = Date.now() + (started.expires_in || 900) * 1000;
  let interval = (started.interval || 5) * 1000;
  for (;;) {
    await wait(interval);
    if (Date.now() > expires) throw new Error('The code expired. Run this again for a new one.');
    const result = await postForm(`${LOGIN}/${tenant}/oauth2/v2.0/token`, { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', client_id: signIn.client, device_code: started.device_code }).catch(() => ({ error: 'authorization_pending' }));
    if (result.access_token) return result.access_token;
    if (result.error === 'slow_down') interval += 5000;
    else if (result.error !== 'authorization_pending') throw new Error(`Microsoft sign-in failed: ${String(result.error_description || result.error).split('\r')[0]}`);
  }
}

async function graph(token, method, url, body) {
  const response = await fetch(`${GRAPH}/v1.0${url}`, { method, signal: AbortSignal.timeout(30000), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Microsoft Graph refused ${url} (${response.status}): ${result.error?.message || ''}`.trim());
  return result;
}

// Exchange Online's admin API, which is what Connect-ExchangeOnline runs its commands through.
async function exchange(session, cmdlet, parameters) {
  const response = await fetch(`${EXCHANGE}/adminapi/beta/${session.tenantId}/InvokeCommand`, { method: 'POST', signal: AbortSignal.timeout(120000), headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json', Accept: 'application/json', 'X-ResponseFormat': 'json', 'X-AnchorMailbox': `UPN:${session.upn}`, 'X-ClientApplication': 'ExoManagementModule', 'X-CmdletName': cmdlet }, body: JSON.stringify({ CmdletInput: { CmdletName: cmdlet, Parameters: parameters } }) });
  const result = await response.json().catch(() => ({}));
  // Exchange's own message is generic; the real reason is in details or innererror, and may itself be JSON.
  const readable = reason => { try { const parsed = JSON.parse(reason); return parsed.Message || parsed.Properties?.message?.Value || reason; } catch { return reason; } };
  const reasons = [].concat((result.error?.details || []).map(detail => detail.message), result.error?.innererror?.message, result.error?.message).filter(Boolean).map(reason => readable(String(reason)).replace(/^\|[^|]*\|/, ''));
  if (!response.ok) throw new Error(`${cmdlet}: ${reasons.filter(reason => reason !== 'Error executing cmdlet').concat(reasons)[0] || `Exchange answered ${response.status}`}`);
  return result.value || [];
}

// This server's key pair, made once (3 years). Microsoft only ever gets the public certificate.
function ensureCertificate() {
  const keyFile = path.join(MAIL_DIR, 'key.pem');
  const certFile = path.join(MAIL_DIR, 'cert.pem');
  if (!fs.existsSync(keyFile) || !fs.existsSync(certFile)) {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '1095', '-subj', '/CN=Open Flashcards sign-up mail', '-keyout', keyFile, '-out', certFile], { stdio: 'ignore' });
    fs.chmodSync(keyFile, 0o600);
  }
  return new crypto.X509Certificate(fs.readFileSync(certFile));
}

export async function connectM365(mailboxArg) {
  const mailbox = String(mailboxArg || '').trim().toLowerCase();
  if (!/^[a-z0-9._+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(mailbox)) throw new Error('Usage: flashcards-admin connect-m365 <mailbox address>');
  fs.mkdirSync(MAIL_DIR, { recursive: true, mode: 0o700 });
  const certificate = ensureCertificate();
  const progressFile = path.join(MAIL_DIR, 'connect.json');
  let progress = readJson(progressFile, {});

  if (!progress.appId || progress.fingerprint !== certificate.fingerprint256) {
    const token = await deviceSignIn(GRAPH_SIGN_IN, 'organizations', 'Sign-in 1 of 2');
    say(`Creating the app "${APP_NAME}"`);
    const app = await graph(token, 'POST', '/applications', { displayName: APP_NAME, signInAudience: 'AzureADMyOrg', notes: 'Sends Open Flashcards sign-up codes. Limited by Exchange to one mailbox. Delete this app to stop all sending.', keyCredentials: [{ type: 'AsymmetricX509Cert', usage: 'Verify', key: certificate.raw.toString('base64'), displayName: 'CN=Open Flashcards sign-up mail' }] });
    let principal = null;
    // A brand-new app can take a few seconds to be known everywhere.
    for (let attempt = 1; !principal; attempt++) { try { principal = await graph(token, 'POST', '/servicePrincipals', { appId: app.appId }); } catch (failure) { if (attempt === 6) throw failure; await wait(5000); } }
    progress = { tenantId: claimsOf(token).tid, appId: app.appId, principalId: principal.id, fingerprint: certificate.fingerprint256 };
    writeJson(progressFile, progress);
  }

  const token = await deviceSignIn(EXCHANGE_SIGN_IN, progress.tenantId, 'Sign-in 2 of 2');
  const claims = claimsOf(token);
  if (claims.tid !== progress.tenantId) throw new Error('That sign-in was for a different Microsoft 365 organisation.');
  const session = { token, tenantId: progress.tenantId, upn: claims.upn || claims.preferred_username || claims.unique_name };

  say(`Checking ${mailbox}`);
  const found = (await exchange(session, 'Get-Recipient', { Identity: mailbox }).catch(failure => { if (notFound(failure)) return []; throw failure; }))[0];
  if (found && String(found.PrimarySmtpAddress).toLowerCase() !== mailbox) throw new Error(`${mailbox} is an extra address of "${found.DisplayName}", so it can't be limited on its own. Choose a different address.`);
  if (found && !/Mailbox$/.test(found.RecipientTypeDetails || '')) throw new Error(`${mailbox} is a ${found.RecipientTypeDetails}, not a mailbox. Choose a different address.`);
  if (!found) {
    say(`Creating the shared mailbox ${mailbox}`);
    await exchange(session, 'New-Mailbox', { Shared: true, Name: `Flashcards ${mailbox.split('@')[0]}`, DisplayName: 'Open Flashcards', Alias: `flashcards-${mailbox.split('@')[0]}`.replace(/[^\w.-]/g, ''), PrimarySmtpAddress: mailbox });
  }

  say(`Letting the app send as ${mailbox} only`);
  const scopeName = `Flashcards mail ${mailbox.replace('@', ' at ')}`.slice(0, 64);
  const filter = `PrimarySmtpAddress -eq '${mailbox}'`;
  await whenFound(() => exchange(session, 'New-ServicePrincipal', { AppId: progress.appId, ObjectId: progress.principalId, DisplayName: APP_NAME }).catch(alreadyThere));
  await whenFound(() => exchange(session, 'New-ManagementScope', { Name: scopeName, RecipientRestrictionFilter: filter }).catch(alreadyThere));
  await whenFound(() => exchange(session, 'New-ManagementRoleAssignment', { Name: `Send ${scopeName}`.slice(0, 64), App: progress.principalId, Role: 'Application Mail.Send', CustomResourceScope: scopeName }).catch(alreadyThere));

  writeJson(path.join(MAIL_DIR, 'config.json'), { tenantId: progress.tenantId, clientId: progress.appId, mailbox });
  say(`\nDone. The server now sends from ${mailbox}. Microsoft can take up to 2 hours to allow the first send from a new mailbox.`);
}
