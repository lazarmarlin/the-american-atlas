// Typed by hand so TypeScript doesn't have to load the multi-megabyte JSON.
declare module "@/lib/catalog-index.json" {
  const index: {
    v: number;
    groups: Record<string, { prefix: string; rows: [string, string, number][] }>;
  };
  export default index;
}
