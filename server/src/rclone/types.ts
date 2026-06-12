export interface RcOptionExample {
  Value: string;
  Help: string;
  Provider?: string;
}

export interface RcOption {
  Name: string;
  FieldName: string;
  Help: string;
  Groups?: string;
  Provider?: string;
  Default: unknown;
  DefaultStr: string;
  Value: unknown;
  ValueStr: string;
  Type: string;
  Examples?: RcOptionExample[];
  ShortOpt?: string;
  Hide: number;
  Required: boolean;
  IsPassword: boolean;
  NoPrefix: boolean;
  Advanced: boolean;
  Exclusive: boolean;
  Sensitive: boolean;
}

export interface RcProvider {
  Name: string;
  Description: string;
  Prefix?: string;
  Options: RcOption[];
  Aliases?: string[] | null;
  Hide: boolean;
}

export interface RemoteSummary {
  name: string;
  type: string;
  parameters: Record<string, string>;
}

/** ConfigOut from the interactive config state-machine (config/create, nonInteractive). */
export interface ConfigOut {
  State?: string;
  Option?: RcOption & { Value?: unknown };
  Error?: string;
  Result?: string;
}
