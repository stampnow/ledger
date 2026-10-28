// Kleine Async-Hülle um localStorage – gleiche Schnittstelle wie zuvor (get/set),
// damit sich der Speicher später leicht gegen IndexedDB tauschen lässt.
const storage = {
  async get(key) {
    const value = window.localStorage.getItem(key);
    return value == null ? null : { value };
  },
  async set(key, value) {
    window.localStorage.setItem(key, value);
  },
};
export default storage;
