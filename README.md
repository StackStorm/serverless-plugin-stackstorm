# Serverless StackStorm plugin

[![serverless](http://public.serverless.com/badges/v3.svg)](http://www.serverless.com)
[![npm version](https://badge.fury.io/js/serverless-plugin-stackstorm.svg)](https://badge.fury.io/js/serverless-plugin-stackstorm)

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
    st2_config:
      user: enykeev
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

custom:
  stackstorm:
    image: 'lambci/lambda:build-python2.7'
    index: 'https://index.stackstorm.org/v1/index.json'

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

## Commands

  The plugin also provides a few optional commands. You don't have to use them as they are all included into `sls package`, but they still might be handy in some situations.

 - `sls stackstorm` - Build λ with StackStorm
 - `sls stackstorm clean` - Clean StackStorm code
 - `sls stackstorm docker pull` - Pull λ docker image
 - `sls stackstorm docker start` - Start λ docker container
 - `sls stackstorm docker stop` - Stop λ docker container
 - `sls stackstorm docker exec` - Execute a command in λ docker container
 - `sls stackstorm install deps` - Install StackStorm dependencies
 - `sls stackstorm install packs` - Install a pack
 - `sls stackstorm install packDeps` - Install dependencies for packs

## Exchange

The available packs can be discovered in StackStorm Exchange (https://exchange.stackstorm.com/). At the moment, the collection consist of 6500+ actions spread across 130 packs. We've yet to try them all, though, but the one we did are marked with [`serverless`](https://exchange.stackstorm.org/#serverless) tag.

## Contributing to Exchange

The StackStorm packs this plugin allows you to run on serverless infrastructure are all part of [StackStorm Exchange](https://github.com/StackStorm-Exchange). We encourage community members to contribute to this packs to enrich the entire ecosystem. The most simple way to help us is to try different packs, mark the one that works with `serverless` keyword and report ones that don't work for some reason. For now, the plugin only supports st2's python runner, but they represent more than 90% of exchange actions.

## Authors

* **Kirill Enykeev** - [enykeev](https://github.com/enykeev)
* **Tomaz Muraus** - [Kami](https://github.com/Kami)
