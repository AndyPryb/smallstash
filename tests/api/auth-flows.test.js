'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CognitoIdentityProviderClient,
  DescribeUserPoolClientCommand,
  InitiateAuthCommand,
} = require('@aws-sdk/client-cognito-identity-provider');
const config = require('./lib/config');

// SRP-only is a deliberate production choice (see SmallstashStack.java's
// WebClient comment and docs/todo.md "API testing approach") - these
// confirm it holds on the *live* client, not just in CDK source, so config
// drift between the two gets caught here instead of discovered by hand
// again.

test('deployed app client only allows SRP + refresh token auth flows (static config)', async () => {
  // DescribeUserPoolClient is an authenticated, admin-facing API - unlike
  // every other test in this suite, this one needs local AWS credentials
  // (the same `aws` CLI profile already used for manual ops in this repo,
  // e.g. creating the test user). Nothing from .env, nothing embedded in
  // the test itself - resolved fresh from the ambient credential chain at
  // run time. If you don't have AWS credentials configured locally, this
  // test fails with a credentials error rather than silently passing.
  const client = new CognitoIdentityProviderClient({ region: config.region });
  const result = await client.send(new DescribeUserPoolClientCommand({
    UserPoolId: config.userPoolId,
    ClientId: config.clientId,
  }));

  const flows = [...(result.UserPoolClient.ExplicitAuthFlows ?? [])].sort();
  assert.deepEqual(flows, ['ALLOW_REFRESH_TOKEN_AUTH', 'ALLOW_USER_SRP_AUTH']);
});

test('USER_PASSWORD_AUTH (a public, non-SRP flow) is rejected at runtime', async () => {
  // InitiateAuth is public/unauthenticated - no AWS credentials needed,
  // same as what a browser client (or an attacker) could attempt directly
  // against the app client. This proves SRP-only is enforced in practice,
  // not just declared in config - real evidence, not an assumption from
  // the static check above.
  const client = new CognitoIdentityProviderClient({ region: config.region });

  await assert.rejects(
    () => client.send(new InitiateAuthCommand({
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: config.clientId,
      AuthParameters: {
        USERNAME: config.testUserEmail,
        PASSWORD: config.testUserPassword,
      },
    })),
    (err) => err.name === 'InvalidParameterException'
  );
});
