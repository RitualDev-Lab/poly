export interface DockerGeneratorOptions {
  workspaceDir: string;
  outputDir?: string;
  devcontainer?: boolean;
  dryRun?: boolean;
  baseImage?: string;
  nodeVersion?: string;
  pythonVersion?: string;
}

export interface GeneratedDockerArtifacts {
  dockerfile: string;
  dockerCompose: string;
  devcontainerJson?: string;
  createdFiles: string[];
}
