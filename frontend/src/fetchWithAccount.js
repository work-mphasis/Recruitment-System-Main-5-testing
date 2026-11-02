/**
 * Patches window.fetch so every backend API call automatically includes
 * X-Accounts (multi-account reads) and X-Account (single-account writes).
 *
 * Admins        → X-Accounts: __ALL__
 * Regular users → X-Accounts: acc1,acc2,...  (all accessible accounts)
 *
 * For explicit writes (AddPositionModal etc.) that pass X-Account themselves,
 * we don't override it. X-Accounts is never overridden if already set.
 */

const API = import.meta.env.VITE_API_URL ?? "";

let _accountsList  = [];   // [] means "not set yet", "__ALL__" means admin
let _writeAccount  = null; // single account for write operations

export function setAccountsList(accounts) {
  _accountsList = accounts; // either "__ALL__" or string[]
}

export function setWriteAccount(account) {
  _writeAccount = account || null;
}

export function clearAccounts() {
  _accountsList  = [];
  _writeAccount  = null;
}

const _originalFetch = window.fetch.bind(window);

window.fetch = function patchedFetch(url, options = {}) {
  if (typeof url !== "string" || !url.startsWith(API)) {
    return _originalFetch(url, options);
  }

  const headers = { ...(options.headers || {}) };

  // Inject X-Accounts for reads (don't override if caller set it explicitly)
  if (!headers["X-Accounts"] && _accountsList.length !== 0) {
    headers["X-Accounts"] =
      _accountsList === "__ALL__" ? "__ALL__" : _accountsList.join(",");
  }

  // Inject X-Account for writes (only when a write account is known and not already set)
  if (!headers["X-Account"] && _writeAccount) {
    headers["X-Account"] = _writeAccount;
  }

  return _originalFetch(url, { ...options, headers });
};
