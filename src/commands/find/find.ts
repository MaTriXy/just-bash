import type { Command, CommandContext, ExecResult } from "../../types.js";
import { hasHelpFlag, showHelp } from "../help.js";

const findHelp = {
  name: "find",
  summary: "search for files in a directory hierarchy",
  usage: "find [path...] [expression]",
  options: [
    "-name PATTERN    file name matches shell pattern PATTERN",
    "-iname PATTERN   like -name but case insensitive",
    "-path PATTERN    file path matches shell pattern PATTERN",
    "-ipath PATTERN   like -path but case insensitive",
    "-type TYPE       file is of type: f (regular file), d (directory)",
    "-empty           file is empty or directory is empty",
    "-mtime N         file's data was modified N*24 hours ago",
    "-newer FILE      file was modified more recently than FILE",
    "-size N[ckMGb]   file uses N units of space (c=bytes, k=KB, M=MB, G=GB, b=512B blocks)",
    "-maxdepth LEVELS descend at most LEVELS directories",
    "-mindepth LEVELS do not apply tests at levels less than LEVELS",
    "-not, !          negate the following expression",
    "-a, -and         logical AND (default)",
    "-o, -or          logical OR",
    "-exec CMD {} ;   execute CMD on each file ({} is replaced by filename)",
    "-exec CMD {} +   execute CMD with multiple files at once",
    "-print           print the full file name (default action)",
    "-print0          print the full file name followed by a null character",
    "-delete          delete found files/directories",
    "    --help       display this help and exit",
  ],
};

function matchGlob(name: string, pattern: string, ignoreCase = false): boolean {
  // Convert glob pattern to regex
  let regex = "^";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*") {
      regex += ".*";
    } else if (c === "?") {
      regex += ".";
    } else if (c === "[") {
      // Character class
      let j = i + 1;
      while (j < pattern.length && pattern[j] !== "]") j++;
      regex += pattern.slice(i, j + 1);
      i = j;
    } else if (/[.+^${}()|\\]/.test(c)) {
      regex += `\\${c}`;
    } else {
      regex += c;
    }
  }
  regex += "$";
  return new RegExp(regex, ignoreCase ? "i" : "").test(name);
}

// Expression types for find
type Expression =
  | { type: "name"; pattern: string; ignoreCase?: boolean }
  | { type: "path"; pattern: string; ignoreCase?: boolean }
  | { type: "type"; fileType: "f" | "d" }
  | { type: "empty" }
  | { type: "mtime"; days: number; comparison: "exact" | "more" | "less" }
  | { type: "newer"; refPath: string }
  | { type: "size"; value: number; unit: "c" | "k" | "M" | "G" | "b"; comparison: "exact" | "more" | "less" }
  | { type: "not"; expr: Expression }
  | { type: "and"; left: Expression; right: Expression }
  | { type: "or"; left: Expression; right: Expression };

// Known predicates that take arguments
const PREDICATES_WITH_ARGS = new Set([
  "-name",
  "-iname",
  "-path",
  "-ipath",
  "-type",
  "-maxdepth",
  "-mindepth",
  "-mtime",
  "-newer",
  "-size",
]);
// Known predicates that don't take arguments
const _PREDICATES_NO_ARGS = new Set([
  "-empty",
  "-not",
  "!",
  "-a",
  "-and",
  "-o",
  "-or",
]);

// Action types for find
type FindAction =
  | { type: "exec"; command: string[]; batchMode: boolean }
  | { type: "print" }
  | { type: "print0" }
  | { type: "delete" };

function parseExpressions(
  args: string[],
  startIndex: number,
): {
  expr: Expression | null;
  pathIndex: number;
  error?: string;
  actions: FindAction[];
} {
  // Parse into tokens: expressions, operators, and negations
  type Token =
    | { type: "expr"; expr: Expression }
    | { type: "op"; op: "and" | "or" }
    | { type: "not" };
  const tokens: Token[] = [];
  const actions: FindAction[] = [];
  let i = startIndex;

  while (i < args.length) {
    const arg = args[i];

    if (arg === "-name" && i + 1 < args.length) {
      tokens.push({ type: "expr", expr: { type: "name", pattern: args[++i] } });
    } else if (arg === "-iname" && i + 1 < args.length) {
      tokens.push({
        type: "expr",
        expr: { type: "name", pattern: args[++i], ignoreCase: true },
      });
    } else if (arg === "-path" && i + 1 < args.length) {
      tokens.push({ type: "expr", expr: { type: "path", pattern: args[++i] } });
    } else if (arg === "-ipath" && i + 1 < args.length) {
      tokens.push({
        type: "expr",
        expr: { type: "path", pattern: args[++i], ignoreCase: true },
      });
    } else if (arg === "-type" && i + 1 < args.length) {
      const fileType = args[++i];
      if (fileType === "f" || fileType === "d") {
        tokens.push({ type: "expr", expr: { type: "type", fileType } });
      } else {
        return {
          expr: null,
          pathIndex: i,
          error: `find: Unknown argument to -type: ${fileType}\n`,
          actions: [],
        };
      }
    } else if (arg === "-empty") {
      tokens.push({ type: "expr", expr: { type: "empty" } });
    } else if (arg === "-mtime" && i + 1 < args.length) {
      const mtimeArg = args[++i];
      let comparison: "exact" | "more" | "less" = "exact";
      let daysStr = mtimeArg;
      if (mtimeArg.startsWith("+")) {
        comparison = "more";
        daysStr = mtimeArg.slice(1);
      } else if (mtimeArg.startsWith("-")) {
        comparison = "less";
        daysStr = mtimeArg.slice(1);
      }
      const days = parseInt(daysStr, 10);
      if (!Number.isNaN(days)) {
        tokens.push({ type: "expr", expr: { type: "mtime", days, comparison } });
      }
    } else if (arg === "-newer" && i + 1 < args.length) {
      const refPath = args[++i];
      tokens.push({ type: "expr", expr: { type: "newer", refPath } });
    } else if (arg === "-size" && i + 1 < args.length) {
      const sizeArg = args[++i];
      let comparison: "exact" | "more" | "less" = "exact";
      let sizeStr = sizeArg;
      if (sizeArg.startsWith("+")) {
        comparison = "more";
        sizeStr = sizeArg.slice(1);
      } else if (sizeArg.startsWith("-")) {
        comparison = "less";
        sizeStr = sizeArg.slice(1);
      }
      // Parse size with optional suffix (c=bytes, k=KB, M=MB, G=GB, default=512-byte blocks)
      const sizeMatch = sizeStr.match(/^(\d+)([ckMGb])?$/);
      if (sizeMatch) {
        const value = parseInt(sizeMatch[1], 10);
        const unit = (sizeMatch[2] || "b") as "c" | "k" | "M" | "G" | "b";
        tokens.push({ type: "expr", expr: { type: "size", value, unit, comparison } });
      }
    } else if (arg === "-not" || arg === "!") {
      tokens.push({ type: "not" });
    } else if (arg === "-o" || arg === "-or") {
      tokens.push({ type: "op", op: "or" });
    } else if (arg === "-a" || arg === "-and") {
      tokens.push({ type: "op", op: "and" });
    } else if (arg === "-maxdepth" || arg === "-mindepth") {
      // These are handled separately, skip them
      i++;
    } else if (arg === "-exec") {
      // Parse -exec command {} ; or -exec command {} +
      const commandParts: string[] = [];
      i++;
      while (i < args.length && args[i] !== ";" && args[i] !== "+") {
        commandParts.push(args[i]);
        i++;
      }
      if (i >= args.length) {
        return {
          expr: null,
          pathIndex: i,
          error: "find: missing argument to `-exec'\n",
          actions: [],
        };
      }
      const batchMode = args[i] === "+";
      actions.push({ type: "exec", command: commandParts, batchMode });
    } else if (arg === "-print") {
      actions.push({ type: "print" });
    } else if (arg === "-print0") {
      actions.push({ type: "print0" });
    } else if (arg === "-delete") {
      actions.push({ type: "delete" });
    } else if (arg.startsWith("-")) {
      // Unknown predicate
      return {
        expr: null,
        pathIndex: i,
        error: `find: unknown predicate '${arg}'\n`,
        actions: [],
      };
    } else {
      // This is the path - skip if at start, otherwise stop
      if (tokens.length === 0) {
        i++;
        continue;
      }
      break;
    }
    i++;
  }

  if (tokens.length === 0) {
    return { expr: null, pathIndex: i, actions };
  }

  // Process NOT operators - they bind to the immediately following expression
  const processedTokens: (Token & { type: "expr" | "op" })[] = [];
  for (let j = 0; j < tokens.length; j++) {
    const token = tokens[j];
    if (token.type === "not") {
      // Find the next expression and negate it
      if (j + 1 < tokens.length && tokens[j + 1].type === "expr") {
        const nextExpr = (tokens[j + 1] as { type: "expr"; expr: Expression })
          .expr;
        processedTokens.push({
          type: "expr",
          expr: { type: "not", expr: nextExpr },
        });
        j++; // Skip the next token since we consumed it
      }
    } else if (token.type === "expr" || token.type === "op") {
      processedTokens.push(token as Token & { type: "expr" | "op" });
    }
  }

  // Build expression tree with proper precedence:
  // 1. Implicit AND (adjacent expressions) has highest precedence
  // 2. Explicit -a has same as implicit AND
  // 3. -o has lowest precedence

  // First pass: group by OR, collecting AND groups
  const orGroups: Expression[][] = [[]];

  for (const token of processedTokens) {
    if (token.type === "op" && token.op === "or") {
      orGroups.push([]);
    } else if (token.type === "expr") {
      orGroups[orGroups.length - 1].push(token.expr);
    }
    // Ignore explicit 'and' - it's same as implicit
  }

  // Combine each AND group
  const andResults: Expression[] = [];
  for (const group of orGroups) {
    if (group.length === 0) continue;
    let result = group[0];
    for (let j = 1; j < group.length; j++) {
      result = { type: "and", left: result, right: group[j] };
    }
    andResults.push(result);
  }

  if (andResults.length === 0) {
    return { expr: null, pathIndex: i, actions };
  }

  // Combine AND results with OR
  let result = andResults[0];
  for (let j = 1; j < andResults.length; j++) {
    result = { type: "or", left: result, right: andResults[j] };
  }

  return { expr: result, pathIndex: i, actions };
}

interface EvalContext {
  name: string;
  relativePath: string;
  isFile: boolean;
  isDirectory: boolean;
  isEmpty: boolean;
  mtime: number; // modification time as timestamp
  size: number; // file size in bytes
  newerRefTimes: Map<string, number>; // reference file mtimes for -newer
}

function evaluateExpression(expr: Expression, ctx: EvalContext): boolean {
  switch (expr.type) {
    case "name":
      return matchGlob(ctx.name, expr.pattern, expr.ignoreCase);
    case "path":
      return matchGlob(ctx.relativePath, expr.pattern, expr.ignoreCase);
    case "type":
      if (expr.fileType === "f") return ctx.isFile;
      if (expr.fileType === "d") return ctx.isDirectory;
      return false;
    case "empty":
      return ctx.isEmpty;
    case "mtime": {
      // mtime is in days, comparison is relative to now
      const now = Date.now();
      const fileAgeDays = (now - ctx.mtime) / (1000 * 60 * 60 * 24);
      if (expr.comparison === "more") {
        return fileAgeDays > expr.days;
      } else if (expr.comparison === "less") {
        return fileAgeDays < expr.days;
      }
      return Math.floor(fileAgeDays) === expr.days;
    }
    case "newer": {
      const refMtime = ctx.newerRefTimes.get(expr.refPath);
      if (refMtime === undefined) return false;
      return ctx.mtime > refMtime;
    }
    case "size": {
      // Convert size to bytes based on unit
      let targetBytes = expr.value;
      switch (expr.unit) {
        case "c": targetBytes = expr.value; break; // bytes
        case "k": targetBytes = expr.value * 1024; break; // kilobytes
        case "M": targetBytes = expr.value * 1024 * 1024; break; // megabytes
        case "G": targetBytes = expr.value * 1024 * 1024 * 1024; break; // gigabytes
        case "b": targetBytes = expr.value * 512; break; // 512-byte blocks (default)
      }
      if (expr.comparison === "more") {
        return ctx.size > targetBytes;
      } else if (expr.comparison === "less") {
        return ctx.size < targetBytes;
      }
      // For exact match with blocks, round up to nearest block
      if (expr.unit === "b") {
        const fileBlocks = Math.ceil(ctx.size / 512);
        return fileBlocks === expr.value;
      }
      return ctx.size === targetBytes;
    }
    case "not":
      return !evaluateExpression(expr.expr, ctx);
    case "and":
      return (
        evaluateExpression(expr.left, ctx) &&
        evaluateExpression(expr.right, ctx)
      );
    case "or":
      return (
        evaluateExpression(expr.left, ctx) ||
        evaluateExpression(expr.right, ctx)
      );
  }
}

export const findCommand: Command = {
  name: "find",
  async execute(args: string[], ctx: CommandContext): Promise<ExecResult> {
    if (hasHelpFlag(args)) {
      return showHelp(findHelp);
    }

    let searchPath = ".";
    let maxDepth: number | null = null;
    let minDepth: number | null = null;

    // Find the path argument and parse -maxdepth/-mindepth
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === "-maxdepth" && i + 1 < args.length) {
        maxDepth = parseInt(args[++i], 10);
      } else if (arg === "-mindepth" && i + 1 < args.length) {
        minDepth = parseInt(args[++i], 10);
      } else if (arg === "-exec") {
        // Skip -exec and all arguments until terminator (; or +)
        i++;
        while (i < args.length && args[i] !== ";" && args[i] !== "+") {
          i++;
        }
        // i now points to the terminator, loop will increment past it
      } else if (!arg.startsWith("-") && arg !== ";" && arg !== "+") {
        searchPath = arg;
      } else if (PREDICATES_WITH_ARGS.has(arg)) {
        // Skip value arguments for predicates that take arguments
        i++;
      }
    }

    // Parse expressions
    const { expr, error, actions } = parseExpressions(args, 0);

    // Return error for unknown predicates
    if (error) {
      return { stdout: "", stderr: error, exitCode: 1 };
    }

    // Determine if we should print results (default) or just execute commands
    const shouldPrint = actions.length === 0;

    const basePath = ctx.fs.resolvePath(ctx.cwd, searchPath);

    // Check if path exists
    try {
      await ctx.fs.stat(basePath);
    } catch {
      return {
        stdout: "",
        stderr: `find: ${searchPath}: No such file or directory\n`,
        exitCode: 1,
      };
    }

    const results: string[] = [];

    // Collect -newer reference file mtimes
    const newerRefTimes = new Map<string, number>();
    const collectNewerRefs = (e: Expression | null): void => {
      if (!e) return;
      if (e.type === "newer") {
        // Will be populated below
      } else if (e.type === "not") {
        collectNewerRefs(e.expr);
      } else if (e.type === "and" || e.type === "or") {
        collectNewerRefs(e.left);
        collectNewerRefs(e.right);
      }
    };
    collectNewerRefs(expr);

    // Resolve -newer reference files
    const resolveNewerRefs = async (e: Expression | null): Promise<void> => {
      if (!e) return;
      if (e.type === "newer") {
        const refFullPath = ctx.fs.resolvePath(ctx.cwd, e.refPath);
        try {
          const refStat = await ctx.fs.stat(refFullPath);
          newerRefTimes.set(e.refPath, refStat.mtime?.getTime() ?? Date.now());
        } catch {
          // Reference file doesn't exist, -newer will always be false
        }
      } else if (e.type === "not") {
        await resolveNewerRefs(e.expr);
      } else if (e.type === "and" || e.type === "or") {
        await resolveNewerRefs(e.left);
        await resolveNewerRefs(e.right);
      }
    };
    await resolveNewerRefs(expr);

    // Recursive function to find files
    async function findRecursive(
      currentPath: string,
      depth: number,
    ): Promise<void> {
      // Check maxdepth - don't descend beyond this depth
      if (maxDepth !== null && depth > maxDepth) {
        return;
      }

      let stat: Awaited<ReturnType<typeof ctx.fs.stat>> | undefined;
      try {
        stat = await ctx.fs.stat(currentPath);
      } catch {
        return;
      }
      if (!stat) return;

      // For the starting directory, use the search path itself as the name
      // (e.g., when searching from '.', the name should be '.')
      let name: string;
      if (currentPath === basePath) {
        name = searchPath.split("/").pop() || searchPath;
      } else {
        name = currentPath.split("/").pop() || "";
      }

      const relativePath =
        currentPath === basePath
          ? searchPath
          : searchPath === "."
            ? `./${currentPath.slice(basePath.length + 1)}`
            : searchPath + currentPath.slice(basePath.length);

      // Determine if entry is empty
      let isEmpty = false;
      if (stat.isFile) {
        // File is empty if size is 0
        isEmpty = stat.size === 0;
      } else if (stat.isDirectory) {
        // Directory is empty if it has no entries
        const entries = await ctx.fs.readdir(currentPath);
        isEmpty = entries.length === 0;
      }

      // Check if this entry matches our criteria
      // Only apply tests if we're at or beyond mindepth
      const atOrBeyondMinDepth = minDepth === null || depth >= minDepth;
      let matches = atOrBeyondMinDepth;

      if (matches && expr !== null) {
        const evalCtx: EvalContext = {
          name,
          relativePath,
          isFile: stat.isFile,
          isDirectory: stat.isDirectory,
          isEmpty,
          mtime: stat.mtime?.getTime() ?? Date.now(),
          size: stat.size ?? 0,
          newerRefTimes,
        };
        matches = evaluateExpression(expr, evalCtx);
      }

      if (matches) {
        results.push(relativePath);
      }

      // Recurse into directories
      if (stat.isDirectory) {
        const entries = await ctx.fs.readdir(currentPath);
        for (const entry of entries) {
          const childPath =
            currentPath === "/" ? `/${entry}` : `${currentPath}/${entry}`;
          await findRecursive(childPath, depth + 1);
        }
      }
    }

    await findRecursive(basePath, 0);

    let stdout = "";
    let stderr = "";
    let exitCode = 0;

    // Execute actions if any
    if (actions.length > 0) {
      for (const action of actions) {
        switch (action.type) {
          case "print":
            stdout += results.length > 0 ? `${results.join("\n")}\n` : "";
            break;

          case "print0":
            stdout += results.length > 0 ? `${results.join("\0")}\0` : "";
            break;

          case "delete":
            // Delete files in reverse order (depth-first) to handle directories
            const sortedForDelete = [...results].sort((a, b) => b.length - a.length);
            for (const file of sortedForDelete) {
              const fullPath = ctx.fs.resolvePath(ctx.cwd, file);
              try {
                await ctx.fs.rm(fullPath, { recursive: false });
              } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                stderr += `find: cannot delete '${file}': ${msg}\n`;
                exitCode = 1;
              }
            }
            break;

          case "exec":
            if (!ctx.exec) {
              return {
                stdout: "",
                stderr: "find: -exec not supported in this context\n",
                exitCode: 1,
              };
            }
            if (action.batchMode) {
              // -exec ... + : execute command once with all files
              const cmdWithFiles: string[] = [];
              for (const part of action.command) {
                if (part === "{}") {
                  cmdWithFiles.push(...results);
                } else {
                  cmdWithFiles.push(part);
                }
              }
              const cmd = cmdWithFiles.map((p) => `"${p}"`).join(" ");
              const result = await ctx.exec(cmd);
              stdout += result.stdout;
              stderr += result.stderr;
              if (result.exitCode !== 0) {
                exitCode = result.exitCode;
              }
            } else {
              // -exec ... ; : execute command for each file
              for (const file of results) {
                const cmdWithFile = action.command.map((part) =>
                  part === "{}" ? file : part,
                );
                const cmd = cmdWithFile.map((p) => `"${p}"`).join(" ");
                const result = await ctx.exec(cmd);
                stdout += result.stdout;
                stderr += result.stderr;
                if (result.exitCode !== 0) {
                  exitCode = result.exitCode;
                }
              }
            }
            break;
        }
      }
    } else if (shouldPrint) {
      // Default: print with newline separator
      stdout = results.length > 0 ? `${results.join("\n")}\n` : "";
    }

    return { stdout, stderr, exitCode };
  },
};
