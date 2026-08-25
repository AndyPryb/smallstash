import {
  CognitoUserPool,
  CognitoUser,
  CognitoUserAttribute,
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
 * @returns {Promise<{ idToken: string, accessToken: string, expiresAt: number, cognitoUser: CognitoUser }>}
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
          // Returned so callers (session.js) can hold onto it for
          // changePassword() later - it already carries the authenticated
          // session internally, no separate re-auth needed for that call.
          cognitoUser,
        });
      },
      onFailure: reject,
      newPasswordRequired: () => {
        reject(new Error('Cognito requires a new password for this account'));
      },
    });
  });
}

/**
 * Self-service sign-up - real users go through this, never admin-create (see
 * docs/architecture.md §9's note on why the manual test user isn't the real
 * flow). Cognito emails a verification code; confirm it with confirmSignUp.
 *
 * Registration is gated by an invite code: it travels as Cognito's
 * `validationData`, which exists precisely for passing extra data to a
 * trigger without storing it on the user. The PreSignUp Lambda
 * (infra/.../SmallstashStack.java) checks it and rejects the sign-up if it
 * doesn't match, so an invalid code means no account is ever created. It is
 * NOT a user attribute - nothing about it is persisted on the account after
 * this call.
 *
 * @param {object} args
 * @param {string} args.userPoolId
 * @param {string} args.clientId
 * @param {string} args.email
 * @param {string} args.password
 * @param {string} args.inviteCode
 */
export function signUp({ userPoolId, clientId, email, password, inviteCode }) {
  const userPool = getPool({ userPoolId, clientId });
  const validationData = [
    new CognitoUserAttribute({ Name: 'inviteCode', Value: inviteCode }),
  ];
  return new Promise((resolve, reject) => {
    userPool.signUp(email, password, [], validationData, (err, result) => {
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

/**
 * Step 1 of Cognito's "forgot password" flow for the login password -
 * distinct from the vault's Recovery Key, which recovers the Master
 * Password instead (docs/architecture.md §5). No prior authentication
 * needed: Cognito emails a verification code to the account's verified
 * email address. Follow up with confirmForgotPassword.
 *
 * @param {object} args
 * @param {string} args.userPoolId
 * @param {string} args.clientId
 * @param {string} args.email
 */
export function forgotPassword({ userPoolId, clientId, email }) {
  const userPool = getPool({ userPoolId, clientId });
  const cognitoUser = new CognitoUser({ Username: email, Pool: userPool });
  return new Promise((resolve, reject) => {
    cognitoUser.forgotPassword({
      onSuccess: resolve,
      onFailure: reject,
    });
  });
}

/**
 * Step 2: complete the reset with the emailed code and a new login
 * password. Cognito enforces the account password policy (12+ chars,
 * upper/lower/digit/symbol - see infra/'s SmallstashStack.java) server-side
 * on this call, same as signUp.
 *
 * @param {object} args
 * @param {string} args.userPoolId
 * @param {string} args.clientId
 * @param {string} args.email
 * @param {string} args.code the emailed verification code
 * @param {string} args.newPassword
 */
export function confirmForgotPassword({ userPoolId, clientId, email, code, newPassword }) {
  const userPool = getPool({ userPoolId, clientId });
  const cognitoUser = new CognitoUser({ Username: email, Pool: userPool });
  return new Promise((resolve, reject) => {
    cognitoUser.confirmPassword(code, newPassword, {
      onSuccess: resolve,
      onFailure: reject,
    });
  });
}

/**
 * Change the login password for an already-authenticated user - requires
 * the CognitoUser instance from a just-completed signIn (carries the
 * session Cognito's ChangePassword API needs), not just an email. See
 * session.js's changeLoginPassword for the caller-facing side.
 *
 * @param {CognitoUser} cognitoUser
 * @param {string} oldPassword
 * @param {string} newPassword
 */
export function changePassword(cognitoUser, oldPassword, newPassword) {
  return new Promise((resolve, reject) => {
    cognitoUser.changePassword(oldPassword, newPassword, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}
