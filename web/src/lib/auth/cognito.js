import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
} from 'amazon-cognito-identity-js';

/**
 * Cognito login - the SRP secret, deliberately independent from the vault
 * Master Password (docs/architecture.md §5). This never touches vault crypto
 * and this module never imports from lib/crypto - keeping that boundary in
 * the file layout, not just in a comment, makes it harder to accidentally
 * blur the two secrets later.
 *
 * SRP means the login password itself never crosses the wire, encrypted or
 * otherwise - only proofs derived from it do. amazon-cognito-identity-js
 * does the actual SRP math; this file just wraps its callback API in a
 * Promise. Same library, same pattern already proven against the live stack
 * in tests/api/lib/auth.js.
 */

let pool;

/** @param {{ userPoolId: string, clientId: string }} config */
function getPool({ userPoolId, clientId }) {
  if (!pool) {
    pool = new CognitoUserPool({ UserPoolId: userPoolId, ClientId: clientId });
  }
  return pool;
}

/**
 * @param {object} args
 * @param {string} args.userPoolId
 * @param {string} args.clientId
 * @param {string} args.email
 * @param {string} args.password Cognito login password - NOT the Master Password
 * @returns {Promise<{ idToken: string, accessToken: string, expiresAt: number }>}
 */
export function signIn({ userPoolId, clientId, email, password }) {
  const userPool = getPool({ userPoolId, clientId });
  const cognitoUser = new CognitoUser({ Username: email, Pool: userPool });
  const authDetails = new AuthenticationDetails({ Username: email, Password: password });

  return new Promise((resolve, reject) => {
    cognitoUser.authenticateUser(authDetails, {
      onSuccess: (session) => {
        resolve({
          idToken: session.getIdToken().getJwtToken(),
          accessToken: session.getAccessToken().getJwtToken(),
          expiresAt: session.getIdToken().getExpiration() * 1000, // ms epoch
        });
      },
      onFailure: reject,
      newPasswordRequired: () => {
        reject(new Error('Cognito requires a new password for this account'));
      },
      mfaRequired: () => {
        reject(new MfaRequiredError(cognitoUser));
      },
      totpRequired: () => {
        reject(new MfaRequiredError(cognitoUser));
      },
    });
  });
}

/**
 * Self-service sign-up - real users go through this, never admin-create (see
 * docs/architecture.md §9's note on why the manual test user isn't the real
 * flow). Cognito emails a verification code; confirm it with confirmSignUp.
 *
 * @param {object} args
 * @param {string} args.userPoolId
 * @param {string} args.clientId
 * @param {string} args.email
 * @param {string} args.password
 */
export function signUp({ userPoolId, clientId, email, password }) {
  const userPool = getPool({ userPoolId, clientId });
  return new Promise((resolve, reject) => {
    userPool.signUp(email, password, [], null, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

/**
 * @param {object} args
 * @param {string} args.userPoolId
 * @param {string} args.clientId
 * @param {string} args.email
 * @param {string} args.code the emailed verification code
 */
export function confirmSignUp({ userPoolId, clientId, email, code }) {
  const userPool = getPool({ userPoolId, clientId });
  const cognitoUser = new CognitoUser({ Username: email, Pool: userPool });
  return new Promise((resolve, reject) => {
    cognitoUser.confirmRegistration(code, true, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

/** Thrown when a login succeeds against the password but still needs an MFA code. */
export class MfaRequiredError extends Error {
  /** @param {CognitoUser} cognitoUser mid-flow user, call sendMFACode on it next */
  constructor(cognitoUser) {
    super('MFA code required');
    this.name = 'MfaRequiredError';
    this.cognitoUser = cognitoUser;
  }
}

/**
 * @param {import('amazon-cognito-identity-js').CognitoUser} cognitoUser from MfaRequiredError
 * @param {string} code
 * @returns {Promise<{ idToken: string, accessToken: string, expiresAt: number }>}
 */
export function submitMfaCode(cognitoUser, code) {
  return new Promise((resolve, reject) => {
    cognitoUser.sendMFACode(code, {
      onSuccess: (session) => {
        resolve({
          idToken: session.getIdToken().getJwtToken(),
          accessToken: session.getAccessToken().getJwtToken(),
          expiresAt: session.getIdToken().getExpiration() * 1000,
        });
      },
      onFailure: reject,
    });
  });
}
