#!/bin/bash
# Run once, in AWS CloudShell, logged in as root. Creates a dedicated IAM
# user for CDK deploys (local `aws configure` now, CI/CD secrets later) -
# see docs/todo.md. Not a console user - programmatic access keys only, so
# MFA (which needs an interactive login) doesn't apply here.
#
# Scope: PowerUserAccess (every AWS service except IAM/Organizations/Account)
# plus a narrow custom policy letting it manage ONLY IAM roles/policies named
# "smallstash-*" or "cdk-*" (CDK's own bootstrap roles use the cdk- prefix).
# This is tighter than handing out AdministratorAccess, but be aware
# PowerUserAccess is still broad by nature - CDK genuinely needs wide access
# to deploy arbitrary stacks. Revisit tightening once the stack is stable.
set -euo pipefail

USER_NAME="smallstash-deployer"

echo "Creating IAM user: $USER_NAME"
aws iam create-user --user-name "$USER_NAME"

echo "Attaching PowerUserAccess"
aws iam attach-user-policy \
  --user-name "$USER_NAME" \
  --policy-arn arn:aws:iam::aws:policy/PowerUserAccess

echo "Attaching scoped IAM role/policy management (needed for CDK to create Lambda/API Gateway execution roles)"
POLICY_FILE="$(mktemp)"
cat > "$POLICY_FILE" <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ScopedIamRoleAndPolicyManagement",
      "Effect": "Allow",
      "Action": [
        "iam:CreateRole",
        "iam:DeleteRole",
        "iam:GetRole",
        "iam:TagRole",
        "iam:UntagRole",
        "iam:UpdateRole",
        "iam:UpdateAssumeRolePolicy",
        "iam:AttachRolePolicy",
        "iam:DetachRolePolicy",
        "iam:PutRolePolicy",
        "iam:DeleteRolePolicy",
        "iam:GetRolePolicy",
        "iam:ListRolePolicies",
        "iam:ListAttachedRolePolicies",
        "iam:CreatePolicy",
        "iam:DeletePolicy",
        "iam:GetPolicy",
        "iam:GetPolicyVersion",
        "iam:ListPolicyVersions",
        "iam:CreatePolicyVersion",
        "iam:DeletePolicyVersion",
        "iam:CreateInstanceProfile",
        "iam:DeleteInstanceProfile",
        "iam:AddRoleToInstanceProfile",
        "iam:RemoveRoleFromInstanceProfile"
      ],
      "Resource": [
        "arn:aws:iam::*:role/smallstash-*",
        "arn:aws:iam::*:role/cdk-*",
        "arn:aws:iam::*:policy/smallstash-*",
        "arn:aws:iam::*:policy/cdk-*",
        "arn:aws:iam::*:instance-profile/cdk-*"
      ]
    },
    {
      "Sid": "ScopedPassRole",
      "Effect": "Allow",
      "Action": "iam:PassRole",
      "Resource": [
        "arn:aws:iam::*:role/smallstash-*",
        "arn:aws:iam::*:role/cdk-*"
      ],
      "Condition": {
        "StringEquals": {
          "iam:PassedToService": [
            "lambda.amazonaws.com",
            "cloudformation.amazonaws.com"
          ]
        }
      }
    }
  ]
}
EOF

aws iam put-user-policy \
  --user-name "$USER_NAME" \
  --policy-name smallstash-deployer-iam-scope \
  --policy-document "file://$POLICY_FILE"
rm -f "$POLICY_FILE"

echo
echo "Creating access key - SAVE THE SecretAccessKey NOW, it is shown only once:"
aws iam create-access-key --user-name "$USER_NAME"

echo
echo "Next: run 'aws configure' locally with these keys (a new named profile"
echo "is cleaner than overwriting your default: aws configure --profile smallstash)."
echo "Never put these keys in the repo - they belong in ~/.aws/credentials or"
echo "your CI provider's secrets store only."
