// Minimal typing for the fengari Lua VM (test-only dependency).
declare module "fengari" {
  type L = unknown;
  export const lua: {
    LUA_OK: number;
    LUA_TNIL: number;
    LUA_TBOOLEAN: number;
    LUA_TNUMBER: number;
    LUA_TSTRING: number;
    LUA_TTABLE: number;
    lua_type(L: L, idx: number): number;
    lua_gettop(L: L): number;
    lua_tojsstring(L: L, idx: number): string;
    lua_tonumber(L: L, idx: number): number;
    lua_toboolean(L: L, idx: number): boolean;
    lua_pushstring(L: L, s: Uint8Array): void;
    lua_pushinteger(L: L, n: number): void;
    lua_pushboolean(L: L, b: boolean): void;
    lua_pushnil(L: L): void;
    lua_pushcfunction(L: L, fn: (L: L) => number): void;
    lua_createtable(L: L, narr: number, nrec: number): void;
    lua_rawseti(L: L, idx: number, n: number): void;
    lua_rawgeti(L: L, idx: number, n: number): number;
    lua_rawlen(L: L, idx: number): number;
    lua_setfield(L: L, idx: number, k: Uint8Array): void;
    lua_setglobal(L: L, name: Uint8Array): void;
    lua_pcall(L: L, nargs: number, nresults: number, msgh: number): number;
    lua_pop(L: L, n: number): void;
  };
  export const lauxlib: {
    luaL_newstate(): L;
    luaL_loadstring(L: L, s: Uint8Array): number;
    luaL_error(L: L, msg: Uint8Array): number;
  };
  export const lualib: { luaL_openlibs(L: L): void };
  export function to_luastring(s: string): Uint8Array;
}
