const versionPattern = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+)(?:\.(\d+))?)?(?:\+[0-9A-Za-z.-]+)?$/
const pyprojectVersionPattern = /^(version\s*=\s*")([^"]+)("\s*)$/m

module.exports = class PythonVersionActions {
  validManifestFilenames = ['pyproject.toml']

  constructor(releaseGroup, projectGraphNode, finalConfigForProject) {
    this.releaseGroup = releaseGroup
    this.projectGraphNode = projectGraphNode
    this.finalConfigForProject = finalConfigForProject
    this.manifestsToUpdate = []
  }

  async init(tree) {
    const configuredRoots = this.finalConfigForProject.manifestRootsToUpdate
    const roots = configuredRoots.length > 0
      ? configuredRoots
      : [{
          path: this.projectGraphNode.data.root,
          preserveLocalDependencyProtocols: this.finalConfigForProject.preserveLocalDependencyProtocols,
        }]

    this.manifestsToUpdate = roots.map((root) => {
      const manifestRoot = typeof root === 'string' ? { path: root } : root
      const path = manifestRoot.path
        .replace('{projectRoot}', this.projectGraphNode.data.root)
        .replace('{projectName}', this.projectGraphNode.name)
        .replace('{workspaceRoot}/', '')

      return {
        ...manifestRoot,
        manifestPath: `${path}/pyproject.toml`,
      }
    })
  }

  async validate(tree) {
    for (const manifest of this.manifestsToUpdate) {
      if (!tree.exists(manifest.manifestPath)) {
        throw new Error(
          `The project "${this.projectGraphNode.name}" does not have a pyproject.toml at ${manifest.manifestPath}.`,
        )
      }
    }
  }

  async readCurrentVersionFromSourceManifest(tree) {
    const manifestPath = `${this.projectGraphNode.data.root}/pyproject.toml`
    const manifest = tree.read(manifestPath, 'utf-8')
    const match = manifest?.match(pyprojectVersionPattern)

    if (!match) {
      throw new Error(
        `Unable to determine the current version for project "${this.projectGraphNode.name}" from ${manifestPath}.`,
      )
    }

    return { currentVersion: match[2], manifestPath }
  }

  async readCurrentVersionFromRegistry() {
    return null
  }

  async readCurrentVersionOfDependency() {
    return { currentVersion: null, dependencyCollection: null }
  }

  async readDependencies(_tree, projectGraph) {
    return (projectGraph.dependencies[this.projectGraphNode.name] ?? []).filter(
      (dependency) => dependency.type !== 'implicit',
    )
  }

  async calculateNewVersion(currentVersion, newVersionInput, _reason, _reasonData, preid) {
    if (versionPattern.test(newVersionInput)) {
      return {
        newVersion: newVersionInput,
        logText: `❓ Applied explicit semver value "${newVersionInput}".`,
      }
    }

    if (!currentVersion) {
      throw new Error(`A current version is required to apply the "${newVersionInput}" version bump.`)
    }

    const current = parseVersion(currentVersion)
    const bump = normalizeBump(newVersionInput, current, this.finalConfigForProject, preid)

    if (!bump) {
      throw new Error(`Unsupported Python package version specifier: "${newVersionInput}".`)
    }

    return {
      newVersion: formatVersion(bump),
      logText: `❓ Applied semver relative bump "${newVersionInput}" to get new version ${formatVersion(bump)}.`,
    }
  }

  async updateProjectVersion(tree, newVersion) {
    for (const manifest of this.manifestsToUpdate) {
      const content = tree.read(manifest.manifestPath, 'utf-8')
      if (!content || !pyprojectVersionPattern.test(content)) {
        throw new Error(`Unable to update the version in ${manifest.manifestPath}.`)
      }

      tree.write(manifest.manifestPath, content.replace(pyprojectVersionPattern, `$1${newVersion}$3`))
    }

    return this.manifestsToUpdate.map(
      ({ manifestPath }) => `✍️  New version ${newVersion} written to manifest: ${manifestPath}`,
    )
  }

  async updateProjectDependencies() {
    return []
  }
}

function parseVersion(version) {
  const match = version.match(versionPattern)
  if (!match) {
    throw new Error(`Invalid semantic version: "${version}".`)
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4],
    prereleaseNumber: match[5] === undefined ? undefined : Number(match[5]),
  }
}

function normalizeBump(specifier, current, configuration, preid) {
  const prereleaseIdentifier = preid || 'pre'
  const adjustedSpecifier = current.major === 0 && configuration.adjustSemverBumpsForZeroMajorVersion !== false
    ? { major: 'minor', minor: 'patch' }[specifier] ?? specifier
    : specifier

  switch (adjustedSpecifier) {
    case 'major':
      return { major: current.major + 1, minor: 0, patch: 0 }
    case 'minor':
      return { major: current.major, minor: current.minor + 1, patch: 0 }
    case 'patch':
      return { major: current.major, minor: current.minor, patch: current.patch + 1 }
    case 'premajor':
      return { major: current.major + 1, minor: 0, patch: 0, prerelease: prereleaseIdentifier, prereleaseNumber: 0 }
    case 'preminor':
      return { major: current.major, minor: current.minor + 1, patch: 0, prerelease: prereleaseIdentifier, prereleaseNumber: 0 }
    case 'prepatch':
      return { major: current.major, minor: current.minor, patch: current.patch + 1, prerelease: prereleaseIdentifier, prereleaseNumber: 0 }
    case 'prerelease':
      if (current.prerelease === prereleaseIdentifier) {
        return { ...current, prereleaseNumber: (current.prereleaseNumber ?? -1) + 1 }
      }
      return { major: current.major, minor: current.minor, patch: current.patch + 1, prerelease: prereleaseIdentifier, prereleaseNumber: 0 }
    default:
      return null
  }
}

function formatVersion(version) {
  const base = `${version.major}.${version.minor}.${version.patch}`
  return version.prerelease
    ? `${base}-${version.prerelease}.${version.prereleaseNumber ?? 0}`
    : base
}
