const fetch = require('node-fetch')
const fs = require('fs')

const override = process.argv.includes('--override')

// TODO: Switch to nextjs-integration-test-data branch once https://github.com/vercel/turbo/pull/5999 is merged.
const RESULT_URL =
  'https://raw.githubusercontent.com/vercel/turbo/nextjs-integration-test-data/test-results/main/nextjs-test-results.json'
const PASSING_JSON_PATH = `${__dirname}/turbopack-tests-manifest.json`
const WORKING_PATH = '/home/runner/work/turbo/turbo/'

const INITIALIZING_TEST_CASES = [
  'compile successfully',
  'should build successfully',
]

const SKIPPED_TEST_SUITES = new Set([
  'test/integration/router-rerender/test/index.test.js',
  'test/e2e/basepath.test.ts',
  'test/development/acceptance-app/ReactRefreshRequire.test.ts',
  'test/integration/dynamic-routing/test/middleware.test.js',
  'test/integration/css/test/css-modules.test.js',
  'test/development/acceptance/ReactRefreshRequire.test.ts',
  'test/integration/custom-routes/test/index.test.js',
  'test/integration/absolute-assetprefix/test/index.test.js',
  'test/e2e/middleware-rewrites/test/index.test.ts',
])

async function updatePassingTests() {
  const passing = { __proto__: null }
  const res = await fetch(RESULT_URL)
  const results = await res.json()

  for (const result of results.result) {
    const runtimeError = result.data.numRuntimeErrorTestSuites > 0
    for (const testResult of result.data.testResults) {
      const filepath = stripWorkingPath(testResult.name)
      for (const file of duplicateFileNames(filepath)) {
        if (SKIPPED_TEST_SUITES.has(file)) continue
        const fileResults = (passing[file] ??= {
          passed: [],
          failed: [],
          pending: [],
          runtimeError,
        })

        let initializationFailed = false
        for (const testCase of testResult.assertionResults) {
          let { fullName, status } = testCase
          if (
            status === 'failed' &&
            INITIALIZING_TEST_CASES.some((name) => fullName.includes(name))
          ) {
            initializationFailed = true
          } else if (initializationFailed) {
            status = 'failed'
          }
          const statusArray = fileResults[status]
          if (!statusArray) {
            throw new Error(`unexpected status "${status}"`)
          }
          statusArray.push(fullName)
        }
      }
    }
  }

  for (const info of Object.values(passing)) {
    info.failed = [...new Set(info.failed)]
    info.pending = [...new Set(info.pending)]
    info.passed = [
      ...new Set(info.passed.filter((name) => !info.failed.includes(name))),
    ]
  }

  if (!override) {
    const oldPassingData = JSON.parse(
      fs.readFileSync(PASSING_JSON_PATH, 'utf8')
    )

    for (const file of Object.keys(oldPassingData)) {
      const newData = passing[file]
      const oldData = oldPassingData[file]
      if (!newData) continue
      // We only want to keep test cases from the old data that are still exiting
      oldData.passed = oldData.passed.filter(
        (name) => newData.failed.includes(name) || newData.passed.includes(name)
      )
      // Grab test cases that passed before, but fail now
      const shouldPass = new Set(
        oldData.passed.filter((name) => newData.failed.includes(name))
      )
      if (shouldPass.size > 0) {
        const list = JSON.stringify([...shouldPass], 0, 2)
        console.log(
          `${file} has ${shouldPass.size} test(s) that should pass but failed: ${list}`
        )
      }
      // Merge the old passing tests with the new ones
      newData.passed = [...new Set([...oldData.passed, ...newData.passed])]
      // but remove them also from the failed list
      newData.failed = newData.failed.filter((name) => !shouldPass.has(name))
    }
  }

  fs.writeFileSync(PASSING_JSON_PATH, JSON.stringify(passing, null, 2))
}

function stripWorkingPath(path) {
  if (!path.startsWith(WORKING_PATH)) {
    throw new Error(
      `found unexpected working path in "${path}", expected it to begin with ${WORKING_PATH}`
    )
  }
  return path.slice(WORKING_PATH.length)
}

function duplicateFileNames(path) {
  if (path.includes('/src/')) {
    const dist = path.replace('/src/', '/dist/').replace(/.tsx?$/, '.js')
    if (fs.existsSync(`${__dirname}/../${dist}`)) {
      return [path, dist]
    }
  }
  return [path]
}

updatePassingTests()
