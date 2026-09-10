declare module 'semver' {
  const semver: {
    valid(version: string): string | null;
    compare(left: string, right: string): number;
  };
  export default semver;
}
