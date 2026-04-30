import { promises as fs } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'

import type {
  CodexSkillDetail,
  CodexSkillSummary,
  CodexSkillsResult,
  CopyCodexSkillInput,
  CopyCodexSkillResult
} from '../shared/codex'

const SKILL_FILE = 'SKILL.md'

function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: string }).code === 'ENOENT'
  )
}

function parseFrontmatter(content: string): { name?: string; description?: string; body: string } {
  const trimmed = content.trimStart()
  if (!trimmed.startsWith('---')) {
    return { body: content }
  }

  const end = trimmed.indexOf('\n---', 3)
  if (end < 0) {
    return { body: content }
  }

  const frontmatter = trimmed.slice(3, end).trim()
  const body = trimmed.slice(end + 4).trim()

  const nameMatch = frontmatter.match(/^name:\s*(.+)$/mu)
  const descriptionMatch = frontmatter.match(/^description:\s*(.+)$/mu)

  const name = nameMatch?.[1]?.trim().replace(/^["']|["']$/gu, '')
  const description = descriptionMatch?.[1]?.trim().replace(/^["']|["']$/gu, '')

  return { name, description, body }
}

function fallbackDescription(body: string): string {
  const lines = body.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed && !trimmed.startsWith('#')) {
      return trimmed.slice(0, 200)
    }
  }

  return ''
}

interface ResolvedInstance {
  id: string
  name: string
  codexHome: string
}

function isPathInsideBase(basePath: string, targetPath: string): boolean {
  const relativePath = relative(resolve(basePath), resolve(targetPath))
  return relativePath !== '' && !relativePath.startsWith('..') && !isAbsolute(relativePath)
}

function normalizeSkillDirName(skillDirName: string): string {
  const normalized = skillDirName.trim()
  if (
    !normalized ||
    normalized.includes('/') ||
    normalized.includes('\\') ||
    normalized.includes('..')
  ) {
    throw new Error('Invalid skill directory name.')
  }

  return normalized
}

async function isSymlink(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.lstat(filePath)
    return stat.isSymbolicLink()
  } catch {
    return false
  }
}

export interface CodexSkillService {
  list(instances: ResolvedInstance[]): Promise<CodexSkillsResult>
  detail(
    instances: ResolvedInstance[],
    instanceId: string,
    skillDirName: string
  ): Promise<CodexSkillDetail>
  copy(instances: ResolvedInstance[], input: CopyCodexSkillInput): Promise<CopyCodexSkillResult>
}

export function createCodexSkillService(): CodexSkillService {
  async function scanInstanceSkills(instance: ResolvedInstance): Promise<{
    skills: CodexSkillSummary[]
    error?: string
  }> {
    const skillsDir = join(instance.codexHome, 'skills')

    let entries: string[]
    try {
      const dirEntries = await fs.readdir(skillsDir, { withFileTypes: true })
      entries = dirEntries
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
        .map((entry) => entry.name)
    } catch (error) {
      if (isMissingPathError(error)) {
        return { skills: [] }
      }

      return { skills: [], error: String(error) }
    }

    const skills: CodexSkillSummary[] = []

    for (const dirName of entries) {
      const skillFile = join(skillsDir, dirName, SKILL_FILE)

      try {
        const content = await fs.readFile(skillFile, 'utf8')
        const { name, description, body } = parseFrontmatter(content)

        skills.push({
          instanceId: instance.id,
          instanceName: instance.name,
          codexHome: instance.codexHome,
          skillDirName: dirName,
          name: name || dirName,
          description: description || fallbackDescription(body),
          filePath: skillFile
        })
      } catch (error) {
        if (!isMissingPathError(error)) {
          // Skip directories without SKILL.md silently
        }
      }
    }

    return { skills }
  }

  async function list(instances: ResolvedInstance[]): Promise<CodexSkillsResult> {
    const results = await Promise.all(instances.map(scanInstanceSkills))

    const skills: CodexSkillSummary[] = []
    const errorsByInstanceId: Record<string, string> = {}

    for (let i = 0; i < results.length; i++) {
      const result = results[i]
      skills.push(...result.skills)
      if (result.error) {
        errorsByInstanceId[instances[i].id] = result.error
      }
    }

    return { skills, errorsByInstanceId, scannedAt: new Date().toISOString() }
  }

  async function detail(
    instances: ResolvedInstance[],
    instanceId: string,
    skillDirName: string
  ): Promise<CodexSkillDetail> {
    const instance = instances.find((item) => item.id === instanceId)
    if (!instance) {
      throw new Error(`Instance ${instanceId} not found.`)
    }

    const normalizedSkillDirName = normalizeSkillDirName(skillDirName)
    const skillsDir = join(instance.codexHome, 'skills')
    const skillDir = join(skillsDir, normalizedSkillDirName)
    if (!isPathInsideBase(skillsDir, skillDir)) {
      throw new Error('Invalid skill directory name.')
    }

    const skillFile = join(skillDir, SKILL_FILE)

    let content: string
    try {
      content = await fs.readFile(skillFile, 'utf8')
    } catch (error) {
      if (isMissingPathError(error)) {
        throw new Error(`Skill ${normalizedSkillDirName} not found in instance ${instance.name}.`)
      }

      throw error
    }

    const { name, description, body } = parseFrontmatter(content)

    return {
      instanceId: instance.id,
      instanceName: instance.name,
      codexHome: instance.codexHome,
      skillDirName: normalizedSkillDirName,
      name: name || normalizedSkillDirName,
      description: description || fallbackDescription(body),
      filePath: skillFile,
      content
    }
  }

  async function copy(
    instances: ResolvedInstance[],
    input: CopyCodexSkillInput
  ): Promise<CopyCodexSkillResult> {
    const sourceInstance = instances.find((item) => item.id === input.sourceInstanceId)
    if (!sourceInstance) {
      throw new Error(`Source instance ${input.sourceInstanceId} not found.`)
    }

    const sourceSkillDirName = normalizeSkillDirName(input.sourceSkillDirName)
    const sourceSkillsDir = join(sourceInstance.codexHome, 'skills')
    const sourceSkillDir = join(sourceSkillsDir, sourceSkillDirName)
    if (!isPathInsideBase(sourceSkillsDir, sourceSkillDir)) {
      throw new Error('Invalid skill directory name.')
    }
    const sourceSkillFile = join(sourceSkillDir, SKILL_FILE)

    // Verify source exists and is not a symlink
    if (await isSymlink(sourceSkillDir)) {
      throw new Error('Source skill directory is a symlink and cannot be copied.')
    }

    try {
      await fs.access(sourceSkillFile)
    } catch (error) {
      if (isMissingPathError(error)) {
        throw new Error(`Source skill ${sourceSkillDirName} not found.`)
      }

      throw error
    }

    const copied: CopyCodexSkillResult['copied'] = []
    const skipped: CopyCodexSkillResult['skipped'] = []
    const failed: CopyCodexSkillResult['failed'] = []

    for (const targetInstanceId of input.targetInstanceIds) {
      const targetInstance = instances.find((item) => item.id === targetInstanceId)
      if (!targetInstance) {
        failed.push({
          targetInstanceId,
          targetInstanceName: targetInstanceId,
          error: 'Instance not found.'
        })

        continue
      }

      const targetSkillsDir = join(targetInstance.codexHome, 'skills')
      const targetSkillDir = join(targetSkillsDir, sourceSkillDirName)

      if (await isSymlink(targetSkillsDir)) {
        failed.push({
          targetInstanceId,
          targetInstanceName: targetInstance.name,
          error: 'Target skills directory is a symlink and cannot be written.'
        })

        continue
      }

      // Verify target skill dir is inside the instance skills directory
      if (!isPathInsideBase(targetSkillsDir, targetSkillDir)) {
        failed.push({
          targetInstanceId,
          targetInstanceName: targetInstance.name,
          error: 'Target path is outside instance skills directory.'
        })

        continue
      }

      try {
        // Check if target already exists
        try {
          await fs.access(targetSkillDir)
          skipped.push({
            targetInstanceId,
            targetInstanceName: targetInstance.name,
            reason: 'Skill already exists in target instance.'
          })

          continue
        } catch (error) {
          if (!isMissingPathError(error)) {
            throw error
          }
        }

        // Ensure skills directory exists
        await fs.mkdir(targetSkillsDir, { recursive: true })

        // Copy the skill directory
        await fs.cp(sourceSkillDir, targetSkillDir, {
          recursive: true,
          force: false,
          errorOnExist: true,
          filter: async (sourcePath) => !(await isSymlink(sourcePath))
        })

        copied.push({
          targetInstanceId,
          targetInstanceName: targetInstance.name
        })
      } catch (error) {
        failed.push({
          targetInstanceId,
          targetInstanceName: targetInstance.name,
          error: String(error instanceof Error ? error.message : error)
        })
      }
    }

    return { copied, skipped, failed }
  }

  return { list, detail, copy }
}
