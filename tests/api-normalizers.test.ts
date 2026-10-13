import { describe, it, expect, beforeEach, vi } from 'vitest'
import { normalizeTmdbMovie, DEFAULT_TMDB_GENRES } from '../server/api/tmdb'
import { normalizeOmdbMovie } from '../server/api/omdb'
import { SimpleCache } from '../server/api/cache'

describe('TMDB Movie Normalizer', () => {
  it('normalizes a standard TMDB movie item', () => {
    const raw = {
      id: 550,
      title: 'Fight Club',
      release_date: '1999-10-15',
      genre_ids: [18, 53],
      poster_path: '/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg',
      overview: 'A ticking-time-bomb insomniac...',
      vote_average: 8.433,
    }

    const normalized = normalizeTmdbMovie(raw, DEFAULT_TMDB_GENRES)

    expect(normalized.id).toBe('550')
    expect(normalized.title).toBe('Fight Club')
    expect(normalized.year).toBe(1999)
    expect(normalized.genres).toEqual(['Drama', 'Thriller'])
    expect(normalized.posterUrl).toContain('/w500/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg')
    expect(normalized.overview).toBe('A ticking-time-bomb insomniac...')
    expect(normalized.rating).toBe(8.4)
  })

  it('handles missing or malformed fields gracefully', () => {
    const raw = {
      id: 123,
      // missing title, release_date, poster_path, vote_average
      name: 'Alternative Title',
      overview: null,
      genre_ids: [9999], // unknown genre
    }

    const normalized = normalizeTmdbMovie(raw, DEFAULT_TMDB_GENRES)

    expect(normalized.id).toBe('123')
    expect(normalized.title).toBe('Alternative Title')
    expect(normalized.year).toBeNull()
    expect(normalized.genres).toEqual([])
    expect(normalized.posterUrl).toBeNull()
    expect(normalized.overview).toBe('')
    expect(normalized.rating).toBeNull()
  })

  it('handles empty or non-object input', () => {
    const normalized = normalizeTmdbMovie(null)
    expect(normalized.id).toBe('')
    expect(normalized.title).toBe('')
    expect(normalized.year).toBeNull()
    expect(normalized.genres).toEqual([])
    expect(normalized.posterUrl).toBeNull()
    expect(normalized.overview).toBe('')
    expect(normalized.rating).toBeNull()
  })

  it('correctly maps genres when genres are an array of objects', () => {
    const raw = {
      id: 456,
      title: 'Test Movie',
      genres: [{ id: 28, name: 'Action' }, { id: 12, name: 'Adventure' }],
    }
    const normalized = normalizeTmdbMovie(raw)
    expect(normalized.genres).toEqual(['Action', 'Adventure'])
  })
})

describe('OMDb Movie Normalizer', () => {
  it('normalizes a detailed OMDb item', () => {
    const raw = {
      imdbID: 'tt0137523',
      Title: 'Fight Club',
      Year: '1999',
      Genre: 'Drama, Thriller',
      Poster: 'https://m.media-amazon.com/images/M/poster.jpg',
      Plot: 'An insomniac office worker...',
      imdbRating: '8.8',
    }

    const normalized = normalizeOmdbMovie(raw)

    expect(normalized.id).toBe('tt0137523')
    expect(normalized.title).toBe('Fight Club')
    expect(normalized.year).toBe(1999)
    expect(normalized.genres).toEqual(['Drama', 'Thriller'])
    expect(normalized.posterUrl).toBe('https://m.media-amazon.com/images/M/poster.jpg')
    expect(normalized.overview).toBe('An insomniac office worker...')
    expect(normalized.rating).toBe(8.8)
  })

  it('handles OMDb N/A placeholders', () => {
    const raw = {
      imdbID: 'tt9999999',
      Title: 'Obscure Film',
      Year: 'N/A',
      Genre: 'N/A',
      Poster: 'N/A',
      Plot: 'N/A',
      imdbRating: 'N/A',
    }

    const normalized = normalizeOmdbMovie(raw)

    expect(normalized.id).toBe('tt9999999')
    expect(normalized.title).toBe('Obscure Film')
    expect(normalized.year).toBeNull()
    expect(normalized.genres).toEqual([])
    expect(normalized.posterUrl).toBeNull()
    expect(normalized.overview).toBe('')
    expect(normalized.rating).toBeNull()
  })

  it('handles search result item with minimal fields', () => {
    const raw = {
      imdbID: 'tt1234567',
      Title: 'Quick Search Result',
      Year: '2021–',
      Type: 'movie',
      Poster: 'https://images.com/pic.jpg',
    }

    const normalized = normalizeOmdbMovie(raw)

    expect(normalized.id).toBe('tt1234567')
    expect(normalized.title).toBe('Quick Search Result')
    expect(normalized.year).toBe(2021)
    expect(normalized.posterUrl).toBe('https://images.com/pic.jpg')
    expect(normalized.genres).toEqual([])
    expect(normalized.overview).toBe('')
    expect(normalized.rating).toBeNull()
  })
})

describe('SimpleCache (In-memory LRU/TTL)', () => {
  it('stores and retrieves cached values within TTL', () => {
    const cache = new SimpleCache<string>(1000, 10)
    cache.set('key1', 'value1')

    expect(cache.has('key1')).toBe(true)
    expect(cache.get('key1')).toBe('value1')
  })

  it('expires items after TTL', () => {
    vi.useFakeTimers()
    try {
      const cache = new SimpleCache<string>(500, 10)
      cache.set('key1', 'value1')

      expect(cache.get('key1')).toBe('value1')

      // Advance time by 600ms
      vi.advanceTimersByTime(600)

      expect(cache.has('key1')).toBe(false)
      expect(cache.get('key1')).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('evicts least-recently-used item when maxSize is reached', () => {
    const cache = new SimpleCache<number>(10000, 3)

    cache.set('a', 1)
    cache.set('b', 2)
    cache.set('c', 3)

    // Access 'a' so 'b' becomes least recently used
    cache.get('a')

    // Add 'd', which should evict 'b'
    cache.set('d', 4)

    expect(cache.has('b')).toBe(false)
    expect(cache.has('a')).toBe(true)
    expect(cache.has('c')).toBe(true)
    expect(cache.has('d')).toBe(true)
    expect(cache.size).toBe(3)
  })

  it('clears all items', () => {
    const cache = new SimpleCache<string>(10000, 5)
    cache.set('k1', 'v1')
    cache.set('k2', 'v2')
    expect(cache.size).toBe(2)

    cache.clear()
    expect(cache.size).toBe(0)
    expect(cache.get('k1')).toBeUndefined()
  })
})
