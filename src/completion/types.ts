export type SupportedShell = "bash" | "zsh" | "fish" | "powershell";

export interface CommandDefinition {
  name: string;
  description: string;
  aliases?: string[];
  options?: OptionDefinition[];
}

export interface OptionDefinition {
  flag: string;
  short?: string;
  description: string;
  takesValue?: boolean;
}
