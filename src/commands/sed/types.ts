// Types for sed command implementation

export type SedAddress = number | "$" | { pattern: string };

export interface AddressRange {
  start?: SedAddress;
  end?: SedAddress;
}

export type SedCommandType =
  | "substitute"
  | "print"
  | "delete"
  | "append"
  | "insert"
  | "change"
  | "hold"
  | "holdAppend"
  | "get"
  | "getAppend"
  | "exchange"
  | "next"
  | "quit";

export interface SubstituteCommand {
  type: "substitute";
  address?: AddressRange;
  pattern: string;
  replacement: string;
  global: boolean;
  ignoreCase: boolean;
  printOnMatch: boolean;
}

export interface PrintCommand {
  type: "print";
  address?: AddressRange;
}

export interface DeleteCommand {
  type: "delete";
  address?: AddressRange;
}

export interface AppendCommand {
  type: "append";
  address?: AddressRange;
  text: string;
}

export interface InsertCommand {
  type: "insert";
  address?: AddressRange;
  text: string;
}

export interface ChangeCommand {
  type: "change";
  address?: AddressRange;
  text: string;
}

// Hold space commands
export interface HoldCommand {
  type: "hold"; // h - copy pattern space to hold space
  address?: AddressRange;
}

export interface HoldAppendCommand {
  type: "holdAppend"; // H - append pattern space to hold space
  address?: AddressRange;
}

export interface GetCommand {
  type: "get"; // g - copy hold space to pattern space
  address?: AddressRange;
}

export interface GetAppendCommand {
  type: "getAppend"; // G - append hold space to pattern space
  address?: AddressRange;
}

export interface ExchangeCommand {
  type: "exchange"; // x - exchange pattern and hold spaces
  address?: AddressRange;
}

export interface NextCommand {
  type: "next"; // n - print pattern space, read next line
  address?: AddressRange;
}

export interface QuitCommand {
  type: "quit"; // q - quit
  address?: AddressRange;
}

export type SedCommand =
  | SubstituteCommand
  | PrintCommand
  | DeleteCommand
  | AppendCommand
  | InsertCommand
  | ChangeCommand
  | HoldCommand
  | HoldAppendCommand
  | GetCommand
  | GetAppendCommand
  | ExchangeCommand
  | NextCommand
  | QuitCommand;

export interface SedState {
  patternSpace: string;
  holdSpace: string;
  lineNumber: number;
  totalLines: number;
  deleted: boolean;
  printed: boolean;
  quit: boolean;
  appendBuffer: string[]; // Lines to append after current line
}
