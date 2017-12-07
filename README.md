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
    stackstorm: # `stackstorm` object replaces `handler`. The rest is the same.
      action: github.get_issue
      config:
        token: ${env:GITHUB_TOKEN}
      input:
        user: "{{ input.pathParameters.user }}"
        repo: "{{ input.pathParameters.repo }}"
        issue_id: "{{ input.pathParameters.issue_id }}"
      output:
        statusCode: 200
        body: "{{ output.result.body }}"
    events:
      - http:
          method: GET
          path: issues/{user}/{repo}/{issue_id}

# custom:
#   stackstorm:
#     runImage: 'lambci/lambda:python2.7'
#     buildImage: 'lambci/lambda:build-python2.7'
#     indexRoot: 'https://index.stackstorm.org/v1/'
#     st2common_pkg: 'git+https://github.com/stackstorm/st2.git#egg=st2common&subdirectory=st2common'
#     python_runner_pkg: 'git+https://github.com/StackStorm/st2.git#egg=python_runner&subdirectory=contrib/runners/python_runner'

plugins:
  - serverless-plugin-stackstorm
```

There are few new options inside the function definition:
  - `stackstorm.action` allows you to pick up a function you want to turn into a lambda
  - `stackstorm.config` sets config parameters for the action. Config parameters are pack-wide in stackstorm and are commonly used for authentication tokens and such.
  - `stackstorm.input` defines how input event parameters should be transformed to match the parameters list stackstorm action expects
  - `stackstorm.output` defines the transformation that should be applied to the action output to form a result of lambda execution

If you are in doubt on the list of parameters given StackStorm action expects, check action info:
```
$ sls stackstorm info --action github.get_issue
github.get_issue .............. Retrieve information about a particular Github issue.
Parameters
  issue_id [string] (required)  Issue id
  repo [string] (required) .... Repository name.
  user [string] (required) .... User / organization name.
Config
  base_url [string] (required)  The GitHub URL, for GitHub Enterprise please set enterprise_url.
  deployment_environment [string] (required)  The environment for this StackStorm server.
  enterprise_url [string]  .... GitHub API url (including /api/v3) of your GitHub Enterprise hostname.
  github_type [string] (required)  Default to either github or enterprise.
  password [string]  .......... GitHub Password
  repository_sensor [object]  . Sensor specific settings.
  token [string] (required) ... GitHub oAuth Token
  user [string]  .............. GitHub Username
```

Then deploy your function to the cloud
```
sls deploy
```

or invoke it locally
```
sls stackstorm docker run -f get_issue -d '{"issue_id": "222"}' --verbose
```

We've added an option of running lambdas inside docker container for when you're running the OS that's not binary compatible with lambda environment. You can still use `sls invoke local`, but you're doing it at your own risk.

The option `--verbose` shows you the whole transformation routine that happened during a particular call:
```
Incoming event ->
{
  "issue_id": "222"
}
-> Parameter transformer ->
{
  "repo": "st2",
  "issue_id": "222",
  "user": "StackStorm"
}
-> Action call ->
{
  "result": {
    "url": "https://github.com/StackStorm/st2/pull/222",
    "created_at": "2014-07-14T19:25:46.000000+00:00",
    ...
  },
  "exit_code": 0,
  "stderr": "",
  "stdout": ""
}
-> Output transformer ->
{
  "result": "2014-07-14T19:25:46.000000+00:00"
}
```

and `--passthrough` option allows you to skip the action call directly and pass input parameters directly to the output transformer for experimenting.

## Commands

  The plugin also provides a few optional commands. You don't have to use them as they are all included into `sls package`, but they still might be handy in some situations.

 - `sls stackstorm` - Build λ with StackStorm
 - `sls stackstorm clean` - Clean StackStorm code
 - `sls stackstorm docker pull` - Pull λ docker image
 - `sls stackstorm docker start` - Start λ docker container
 - `sls stackstorm docker stop` - Stop λ docker container
 - `sls stackstorm docker exec` - Execute a command in λ docker container
 - `sls stackstorm docker run` - Execute a function in λ docker container
 - `sls stackstorm install adapter` - Install StackStorm adapter
 - `sls stackstorm install deps` - Install StackStorm dependencies
 - `sls stackstorm install packs` - Install a pack
 - `sls stackstorm install packDeps` - Install dependencies for packs
 - `sls stackstorm info` - Print information on the action

## Exchange

The available packs can be discovered in StackStorm Exchange (https://exchange.stackstorm.com/). At the moment, the collection consist of 6500+ actions spread across 130 packs. We've yet to try them all, though, but the one we did are marked with [`serverless`](https://exchange.stackstorm.org/#serverless) tag.

## Contributing to Exchange

The StackStorm packs this plugin allows you to run on serverless infrastructure are all part of [StackStorm Exchange](https://github.com/StackStorm-Exchange). We encourage community members to contribute to this packs to enrich the entire ecosystem. The most simple way to help us is to try different packs, mark the one that works with `serverless` keyword and report ones that don't work for some reason. For now, the plugin only supports stackstorm's python runner, but they represent more than 90% of exchange actions.

## Authors

* **Kirill Enykeev** - [enykeev](https://github.com/enykeev)
* **Tomaz Muraus** - [Kami](https://github.com/Kami)
