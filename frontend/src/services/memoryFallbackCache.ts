/**
 * In-memory fallback cache for when IndexedDB is unavailable.
 *
 * Mimics Dexie table API surface used by cache services.
 * Data is not persisted — lost on page refresh (acceptable for private browsing).
 *
 * @module services/memoryFallbackCache
 */

export interface MemoryWhereClause<T> {
  equals(value: unknown): MemoryCollection<T>
  toArray(): Promise<T[]>
  delete(): Promise<number>
  count(): Promise<number>
  filter(fn: (item: T) => boolean): MemoryCollection<T>
  first(): Promise<T | undefined>
}

export interface MemoryCollection<T> {
  toArray(): Promise<T[]>
  delete(): Promise<number>
  count(): Promise<number>
  filter(fn: (item: T) => boolean): MemoryCollection<T>
  first(): Promise<T | undefined>
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class MemoryTable<T extends { id: string; [key: string]: any }> {
  private store = new Map<string, T>()

  async get(key: string): Promise<T | undefined> {
    return this.store.get(key)
  }

  async put(item: T): Promise<string> {
    const key = String(item.id)
    this.store.set(key, item)
    return key
  }

  async add(item: T): Promise<string> {
    return this.put(item)
  }

  async update(key: string, changes: Partial<T>): Promise<number> {
    const existing = this.store.get(key)
    if (!existing) return 0
    this.store.set(key, { ...existing, ...changes })
    return 1
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key)
  }

  async bulkPut(items: T[]): Promise<void> {
    for (const item of items) {
      await this.put(item)
    }
  }

  async bulkDelete(keys: string[]): Promise<void> {
    for (const key of keys) {
      this.store.delete(key)
    }
  }

  async toArray(): Promise<T[]> {
    return Array.from(this.store.values())
  }

  async count(): Promise<number> {
    return this.store.size
  }

  async clear(): Promise<void> {
    this.store.clear()
  }

  where(fieldOrCompound: string | Record<string, unknown>): MemoryWhereClause<T> {
    if (typeof fieldOrCompound === 'object') {
      return this.createCompoundWhereClause(fieldOrCompound)
    }
    return this.createWhereClause(fieldOrCompound)
  }

  filter(fn: (item: T) => boolean): MemoryCollection<T> {
    return this.createCollection(fn)
  }

  orderBy(field: string): MemoryCollection<T> {
    const sortFn = (a: T, b: T) => {
      const aVal = a[field]
      const bVal = b[field]
      if (typeof aVal === 'number' && typeof bVal === 'number') return aVal - bVal
      return String(aVal).localeCompare(String(bVal))
    }

    return {
      toArray: async () => Array.from(this.store.values()).sort(sortFn),
      delete: async () => {
        const size = this.store.size
        this.store.clear()
        return size
      },
      count: async () => this.store.size,
      filter: (fn: (item: T) => boolean) => this.createCollection(fn),
      first: async () => Array.from(this.store.values()).sort(sortFn)[0],
    }
  }

  private createWhereClause(field: string): MemoryWhereClause<T> {
    const collection = this.createCollection(() => true)

    return {
      ...collection,
      equals: (value: unknown): MemoryCollection<T> => {
        const isCompound = field.startsWith('[') && field.endsWith(']')

        if (isCompound && Array.isArray(value)) {
          const fields = field.slice(1, -1).split('+')
          return this.createCollection((item) =>
            fields.every((f, i) => item[f] === (value as unknown[])[i]),
          )
        }

        return this.createCollection((item) => item[field] === value)
      },
    }
  }

  private createCompoundWhereClause(criteria: Record<string, unknown>): MemoryWhereClause<T> {
    const baseCollection = this.createCollection((item) =>
      Object.entries(criteria).every(([k, v]) => item[k] === v),
    )

    return {
      ...baseCollection,
      equals: (value: unknown): MemoryCollection<T> => {
        if (Array.isArray(value)) {
          const fields = Object.keys(criteria)
          return this.createCollection((item) =>
            fields.every((f, i) => item[f] === (value as unknown[])[i]),
          )
        }
        return this.createCollection(() => false)
      },
    }
  }

  private createCollection(predicate: (item: T) => boolean): MemoryCollection<T> {
    const getFiltered = () => Array.from(this.store.values()).filter(predicate)

    return {
      toArray: async () => getFiltered(),
      delete: async () => {
        const items = getFiltered()
        for (const item of items) {
          this.store.delete(String(item.id))
        }
        return items.length
      },
      count: async () => getFiltered().length,
      filter: (fn: (item: T) => boolean) =>
        this.createCollection((item) => predicate(item) && fn(item)),
      first: async () => getFiltered()[0],
    }
  }
}
