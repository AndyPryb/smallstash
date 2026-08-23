'use strict';

const {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
} = require('amazon-cognito-identity-js');

/**
 * Real SRP authentication against the deployed Cognito pool - no
 * admin-initiate-auth shortcut, no .adminUserPassword(true) app client
 * flow. The app client is SRP-only in the live stack (verify with
 * `aws cognito-idp describe-user-pool-client` if that's ever in doubt -
 * see docs/todo.md "API testing approach"). This is also an early
 * prototype of the PWA's own future auth code.
 */
function signIn({ userPoolId, clientId, email, password }) {
  const userPool = new CognitoUserPool({ UserPoolId: userPoolId, ClientId: clientId });
  const cognitoUser = new CognitoUser({ Username: email, Pool: userPool });
  const authDetails = new AuthenticationDetails({ Username: email, Password: password });

  return new Promise((resolve, reject) => {
    cognitoUser.authenticateUser(authDetails, {
      onSuccess: (session) => {
        resolve({
          idToken: session.getIdToken().getJwtToken(),
          accessToken: session.getAccessToken().getJwtToken(),
        });
      },
      onFailure: (err) => reject(err),
      newPasswordRequired: () => {
        reject(new Error(
          'Cognito returned NEW_PASSWORD_REQUIRED - the test user\'s password ' +
          'was not set as permanent. Recreate it with ' +
          '`aws cognito-idp admin-set-user-password --permanent`.'
        ));
      },
    });
  });
}

module.exports = { signIn };
