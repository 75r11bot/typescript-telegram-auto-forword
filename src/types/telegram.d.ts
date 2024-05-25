// src/types/telegram.d.ts

declare module "telegram" {
  import { EventEmitter } from "events";

  export class TelegramClient extends EventEmitter {
    [x: string]: any;
    getSelf: any;
    getMe() {
      throw new Error("Method not implemented.");
    }
    constructor(session: any, apiId: number, apiHash: string, options?: any);
    start(options: any): Promise<void>;
    getDialogs(): Promise<any[]>;
    forwardMessages(toPeer: any, options: any): Promise<void>;
    addEventHandler(handler: (event: any) => void, filter: any): void;
    session: any;
  }
}

declare module "telegram/sessions" {
  export class StringSession {
    constructor(session: string);
  }
}

declare module "telegram/events" {
  export class NewMessage {
    constructor(options: any);
  }

  export namespace Api {
    export class UpdateNewMessage {
      message: any;
    }
  }
}
