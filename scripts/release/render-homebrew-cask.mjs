import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

function parseArgs(argv) {
  const args = {}

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) {
      continue
    }

    const key = token.slice(2)
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for --${key}`)
    }

    args[key] = value
    index += 1
  }

  return args
}

function requiredArg(args, name) {
  const value = args[name]?.trim()
  if (!value) {
    throw new Error(`Missing required argument --${name}`)
  }

  return value
}

function renderCask(options) {
  const lines = [
    '# typed: false',
    '# frozen_string_literal: true',
    '',
    `cask "${options.token}" do`,
    `  version "${options.version}"`,
    `  sha256 "${options.sha256}"`,
    '',
    `  url "${options.url}"`,
    `  name "${options.name}"`,
    `  desc "${options.desc}"`,
    `  homepage "${options.homepage}"`,
    '',
    `  depends_on arch: :${options.arch}`,
    '',
    `  app "${options.app}"`,
    'end',
    ''
  ]

  return lines.join('\n')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const output = requiredArg(args, 'output')
  const content = renderCask({
    token: args.token?.trim() || 'ilovecodex',
    version: requiredArg(args, 'version'),
    sha256: requiredArg(args, 'sha256'),
    url: requiredArg(args, 'url'),
    name: args.name?.trim() || 'Ilovecodex',
    desc: args.desc?.trim() || 'Desktop account manager for Codex sessions',
    homepage: args.homepage?.trim() || 'https://github.com/bee1an/ILoveCodex',
    arch: args.arch?.trim() || 'arm64',
    app: args.app?.trim() || 'Ilovecodex.app'
  })

  await mkdir(path.dirname(output), { recursive: true })
  await writeFile(output, content, 'utf8')
  process.stdout.write(`Rendered ${output}\n`)
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
