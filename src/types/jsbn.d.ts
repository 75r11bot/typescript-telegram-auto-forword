declare module "jsbn" {
  export class BigInteger {
    constructor(a: string | number | BigInteger, b?: number);
    equals(a: BigInteger): boolean;
    toString(): string;
  }
}
