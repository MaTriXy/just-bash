export interface AwkContext {
  FS: string;
  OFS: string;
  NR: number;
  NF: number;
  fields: string[];
  line: string;
  vars: Record<string, string | number>;
  arrays: Record<string, Record<string, string | number>>;
}

export interface AwkRule {
  pattern: string | null;
  action: string;
}

export interface ParsedProgram {
  begin: string | null;
  main: AwkRule[];
  end: string | null;
}
