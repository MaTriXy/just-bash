/**
 * Built-in Command Handlers
 *
 * Shell built-in commands that modify interpreter state:
 * - cd: Change directory
 * - export: Set environment variables
 * - unset: Remove variables/functions
 * - exit: Exit shell
 * - local: Declare local variables in functions
 */

import type { ExecResult } from "../types.js";
import type { InterpreterContext } from "./types.js";

export async function handleCd(
  ctx: InterpreterContext,
  args: string[],
): Promise<ExecResult> {
  let target: string;

  if (args.length === 0 || args[0] === "~") {
    target = ctx.state.env.HOME || "/";
  } else if (args[0] === "-") {
    target = ctx.state.previousDir;
  } else {
    target = args[0];
  }

  const newDir = ctx.fs.resolvePath(ctx.state.cwd, target);

  try {
    const statResult = await ctx.fs.stat(newDir);
    if (!statResult.isDirectory) {
      return {
        stdout: "",
        stderr: `bash: cd: ${target}: Not a directory\n`,
        exitCode: 1,
      };
    }
  } catch {
    if (newDir !== "/") {
      return {
        stdout: "",
        stderr: `bash: cd: ${target}: No such file or directory\n`,
        exitCode: 1,
      };
    }
  }

  ctx.state.previousDir = ctx.state.cwd;
  ctx.state.cwd = newDir;
  ctx.state.env.PWD = ctx.state.cwd;
  ctx.state.env.OLDPWD = ctx.state.previousDir;

  return { stdout: "", stderr: "", exitCode: 0 };
}

export function handleExport(
  ctx: InterpreterContext,
  args: string[],
): ExecResult {
  for (const arg of args) {
    if (arg.includes("=")) {
      const [name, ...rest] = arg.split("=");
      ctx.state.env[name] = rest.join("=");
    }
  }
  return { stdout: "", stderr: "", exitCode: 0 };
}

export function handleUnset(
  ctx: InterpreterContext,
  args: string[],
): ExecResult {
  for (const arg of args) {
    delete ctx.state.env[arg];
    ctx.state.functions.delete(arg);
  }
  return { stdout: "", stderr: "", exitCode: 0 };
}

export function handleExit(
  _ctx: InterpreterContext,
  args: string[],
): ExecResult {
  const code = args.length > 0 ? Number.parseInt(args[0], 10) || 0 : 0;
  return { stdout: "", stderr: "", exitCode: code };
}

export function handleLocal(
  ctx: InterpreterContext,
  args: string[],
): ExecResult {
  if (ctx.state.localScopes.length === 0) {
    return {
      stdout: "",
      stderr: "bash: local: can only be used in a function\n",
      exitCode: 1,
    };
  }

  const currentScope = ctx.state.localScopes[ctx.state.localScopes.length - 1];

  for (const arg of args) {
    if (arg.includes("=")) {
      const [name, ...rest] = arg.split("=");
      if (!currentScope.has(name)) {
        currentScope.set(name, ctx.state.env[name]);
      }
      ctx.state.env[name] = rest.join("=");
    } else {
      if (!currentScope.has(arg)) {
        currentScope.set(arg, ctx.state.env[arg]);
      }
    }
  }

  return { stdout: "", stderr: "", exitCode: 0 };
}

const SET_USAGE = `set: usage: set [-e] [+e] [-o option] [+o option]
Options:
  -e          Exit immediately if a command exits with non-zero status
  +e          Disable -e
  -o errexit  Same as -e
  +o errexit  Disable errexit
`;

// Valid short options for set
const VALID_SET_OPTIONS = new Set(["e"]);

// Valid long options for set -o / +o
const VALID_SET_LONG_OPTIONS = new Set(["errexit"]);

export function handleSet(ctx: InterpreterContext, args: string[]): ExecResult {
  if (args.includes("--help")) {
    return { stdout: SET_USAGE, stderr: "", exitCode: 0 };
  }

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (arg === "-e") {
      ctx.state.options.errexit = true;
    } else if (arg === "+e") {
      ctx.state.options.errexit = false;
    } else if (arg === "-o" && i + 1 < args.length) {
      const optName = args[i + 1];
      if (!VALID_SET_LONG_OPTIONS.has(optName)) {
        return {
          stdout: "",
          stderr: `bash: set: ${optName}: invalid option name\n${SET_USAGE}`,
          exitCode: 1,
        };
      }
      if (optName === "errexit") {
        ctx.state.options.errexit = true;
      }
      i++;
    } else if (arg === "+o" && i + 1 < args.length) {
      const optName = args[i + 1];
      if (!VALID_SET_LONG_OPTIONS.has(optName)) {
        return {
          stdout: "",
          stderr: `bash: set: ${optName}: invalid option name\n${SET_USAGE}`,
          exitCode: 1,
        };
      }
      if (optName === "errexit") {
        ctx.state.options.errexit = false;
      }
      i++;
    } else if (arg === "-o" || arg === "+o") {
      // -o or +o without argument
      return {
        stdout: "",
        stderr: `bash: set: ${arg}: option requires an argument\n${SET_USAGE}`,
        exitCode: 1,
      };
    } else if (arg.startsWith("-") && arg.length > 1 && arg[1] !== "-") {
      // Handle combined flags like -ex
      for (let j = 1; j < arg.length; j++) {
        const flag = arg[j];
        if (!VALID_SET_OPTIONS.has(flag)) {
          return {
            stdout: "",
            stderr: `bash: set: -${flag}: invalid option\n${SET_USAGE}`,
            exitCode: 1,
          };
        }
        if (flag === "e") {
          ctx.state.options.errexit = true;
        }
      }
    } else if (arg.startsWith("+") && arg.length > 1) {
      // Handle combined flags like +ex
      for (let j = 1; j < arg.length; j++) {
        const flag = arg[j];
        if (!VALID_SET_OPTIONS.has(flag)) {
          return {
            stdout: "",
            stderr: `bash: set: +${flag}: invalid option\n${SET_USAGE}`,
            exitCode: 1,
          };
        }
        if (flag === "e") {
          ctx.state.options.errexit = false;
        }
      }
    } else if (arg === "--") {
      // End of options, rest are positional parameters (not implemented)
      break;
    } else if (arg.startsWith("-") || arg.startsWith("+")) {
      return {
        stdout: "",
        stderr: `bash: set: ${arg}: invalid option\n${SET_USAGE}`,
        exitCode: 1,
      };
    }
    // Other arguments are positional parameters (not implemented)

    i++;
  }

  return { stdout: "", stderr: "", exitCode: 0 };
}
