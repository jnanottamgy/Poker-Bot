/**
 * Compile-time assertion helpers. They have no runtime footprint: a failing
 * assertion is a type error reported by `tsc`, never a runtime check.
 */

/** Exact type equality (distinguishes `any`, optionality and readonly-ness). */
export type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/** `Assert<X>` only compiles when X is exactly `true`. */
export type Assert<T extends true> = T;

/** True when every value of A is assignable to B. */
export type Extends<A, B> = [A] extends [B] ? true : false;
