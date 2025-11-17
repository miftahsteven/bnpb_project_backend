declare module 'node-fetch' {
    // minimal supaya TS diam; kalau mau rapi, bisa definisikan tipe Response, dll.
    const fetch: any;
    export default fetch;
}
