# Serverless StackStorm plugin

[![serverless](http://public.serverless.com/badges/v3.svg)](http://www.serverless.com)

Run StackStorm actions serverless and stackstormless.

## Prerequisite
- docker - https://docs.docker.com/engine/installation/

## Getting Started
Install the plugin
```
npm i --save-dev serverless-plugin-stackstorm
```

Configure your service to use the plugin

```yaml
service: my-service

provider:
  name: aws
  runtime: python2.7 # StackStorm runners are based on Python 2

functions:
  get_issue:
    st2_function: github.get_issue # `st2_function` notation replaces `handler`. The rest is the same.
    events:
      - http:
          method: GET
          path: issues/{user}/{repo}/{issue_id}
          integration: lambda
          request:
            template:
              application/json: >
                {
                  "user": "$input.params('user')",
                  "repo": "$input.params('repo')",
                  "issue_id": "$input.params('issue_id')"
                }

plugins:
  - serverless-plugin-stackstorm
```

Then deploy your function to the cloud
```
sls deploy
```

or invoke it locally
```
echo '{"user": "StackStorm", "repo": "st2", "issue_id": "3785"}' | sls invoke local --function get_issue
```

## Authors

* **Kirill Enykeev** - [enykeev](https://github.com/enykeev)
* **Tomaz Muraus** - [Kami](https://github.com/Kami)
