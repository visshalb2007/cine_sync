import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest'
import { searchTmdb, searchMovies, tmdbCache } from '../server/api/tmdb'
import { searchOmdb, omdbCache } from '../server/api/omdb'
import { createIpRateLimiter } from '../server/api/rateLimiter'
import { app } from '../server/index'

describe('Search API Clients with Mock Fetch', () => {
  const originalFetch = global.fetch
  const originalEnv = { ...process.env }

  beforeEach(() => {
    tmdbCache.clear()
    omdbCache.clear()
    process.env.TMDB_API_KEY = 'test_tmdb_key_123'
    process.env.OMDB_API_KEY = 'test_omdb_key_456'
  })

  afterEach(() => {
    global.fetch = originalFetch
    process.env = { ...originalEnv }
    vi.restoreAllMocks()
  })

  it('searchTmdb calls TMDB API with correct query params and returns normalized results', async () => {
    const mockTmdbResponse = {
      page: 1,
      results: [
        {
          id: 101,
          title: 'Inception',
          release_date: '2010-07-16',
          genre_ids: [28, 878],
          poster_path: '/inception.jpg',
          overview: 'Your mind is the scene of the crime.',
          vote_average: 8.8,
        },
      ],
      total_pages: 1,
      total_results: 1,
    }

    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('genre/movie/list')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              genres: [
                { id: 28, name: 'Action' },
                { id: 878, name: 'Science Fiction' },
              ],
            }),
        })
      }
      if (url.includes('search/movie')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockTmdbResponse),
        })
      }
      return Promise.reject(new Error('Unknown url: ' + url))
    })

    global.fetch = mockFetch as any

    const result = await searchTmdb({ query: 'Inception', year: 2010, page: 1 })

    expect(mockFetch).toHaveBeenCalled()
    expect(result.results).toHaveLength(1)
    expect(result.results[0].title).toBe('Inception')
    expect(result.results[0].year).toBe(2010)
    expect(result.results[0].genres).toEqual(['Action', 'Science Fiction'])
    expect(result.results[0].posterUrl).toContain('/w500/inception.jpg')
    expect(result.results[0].rating).toBe(8.8)
  })

  it('searchMovies falls back to OMDb if TMDB fails', async () => {
    const mockOmdbResponse = {
      Search: [
        {
          Title: 'The Matrix',
          Year: '1999',
          imdbID: 'tt0133093',
          Type: 'movie',
          Poster: 'https://images.com/matrix.jpg',
        },
      ],
      totalResults: '1',
      Response: 'True',
    }

    const mockOmdbDetail = {
      Title: 'The Matrix',
      Year: '1999',
      imdbID: 'tt0133093',
      Genre: 'Action, Sci-Fi',
      Poster: 'https://images.com/matrix.jpg',
      Plot: 'A computer hacker learns the truth...',
      imdbRating: '8.7',
      Response: 'True',
    }

    const mockFetch = vi.fn().mockImplementation((url: string) => {
      // Simulate TMDB failure
      if (url.includes('api.themoviedb.org')) {
        return Promise.resolve({
          ok: false,
          status: 500,
        })
      }
      // OMDb search response
      if (url.includes('omdbapi.com') && url.includes('&s=')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockOmdbResponse),
        })
      }
      // OMDb detail response
      if (url.includes('omdbapi.com') && url.includes('&i=')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockOmdbDetail),
        })
      }
      return Promise.reject(new Error('Unknown url'))
    })

    global.fetch = mockFetch as any

    const result = await searchMovies({ query: 'Matrix' })

    expect(result.results).toHaveLength(1)
    expect(result.results[0].id).toBe('tt0133093')
    expect(result.results[0].title).toBe('The Matrix')
    expect(result.results[0].year).toBe(1999)
    expect(result.results[0].overview).toBe('A computer hacker learns the truth...')
    expect(result.results[0].genres).toEqual(['Action', 'Sci-Fi'])
    expect(result.results[0].rating).toBe(8.7)
  })

  it('fails gracefully when neither TMDB nor OMDb has valid credentials', async () => {
    process.env.TMDB_API_KEY = ''
    process.env.OMDB_API_KEY = ''

    const result = await searchMovies({ query: 'Something' })
    expect(result.results).toEqual([])
    expect(result.total_results).toBe(0)
  })
})

describe('REST Endpoint Validation & Security', () => {
  let server: any
  let baseUrl = ''

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const port = (server.address() as any).port
        baseUrl = `http://127.0.0.1:${port}`
        resolve()
      })
    })
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      if (server) server.close(() => resolve())
      else resolve()
    })
  })

  it('rejects /api/search with 400 when "q" is missing or empty', async () => {
    // Missing q
    const res1 = await fetch(`${baseUrl}/api/search`)
    expect(res1.status).toBe(400)
    const data1 = (await res1.json()) as any
    expect(data1.error).toMatch(/required/i)

    // Empty whitespace q
    const res2 = await fetch(`${baseUrl}/api/search?q=%20%20%20`)
    expect(res2.status).toBe(400)
    const data2 = (await res2.json()) as any
    expect(data2.error).toMatch(/required/i)
  })

  it('rejects /api/search with 400 when "year" is invalid', async () => {
    const res = await fetch(`${baseUrl}/api/search?q=Inception&year=not-a-year`)
    expect(res.status).toBe(400)
    const data = (await res.json()) as any
    expect(data.error).toMatch(/year/i)
  })

  it('rejects /api/search with 400 when "page" is invalid', async () => {
    const res = await fetch(`${baseUrl}/api/search?q=Inception&page=-5`)
    expect(res.status).toBe(400)
    const data = (await res.json()) as any
    expect(data.error).toMatch(/page/i)
  })

  it('rejects /api/movies with 400 when "page" is invalid', async () => {
    const res = await fetch(`${baseUrl}/api/movies?page=invalid`)
    expect(res.status).toBe(400)
    const data = (await res.json()) as any
    expect(data.error).toMatch(/page/i)
  })

  it('successfully retrieves genres from /api/genres', async () => {
    const res = await fetch(`${baseUrl}/api/genres`)
    expect(res.status).toBe(200)
    const data = (await res.json()) as any
    expect(data.genres).toBeDefined()
    expect(Array.isArray(data.genres)).toBe(true)
    expect(data.genres.length).toBeGreaterThan(0)
  })

  it('never exposes API keys in error responses or body', async () => {
    process.env.TMDB_API_KEY = 'secret_tmdb_key_99999'
    process.env.OMDB_API_KEY = 'secret_omdb_key_88888'

    const res = await fetch(`${baseUrl}/api/search?q=Batman`)
    const text = await res.text()

    expect(text).not.toContain('secret_tmdb_key_99999')
    expect(text).not.toContain('secret_omdb_key_88888')
  })

  it('rate limiter middleware enforces limit per IP', () => {
    const limiter = createIpRateLimiter({
      windowMs: 60 * 1000,
      max: 2,
      message: 'Rate limit exceeded',
    })

    const req: any = {
      headers: {},
      socket: { remoteAddress: '192.168.1.100' },
    }
    let status = 200
    let body: any = null
    const res: any = {
      status(s: number) {
        status = s
        return this
      },
      json(b: any) {
        body = b
        return this
      },
      setHeader() {
        return this
      },
    }
    let nextCalled = 0
    const next = () => {
      nextCalled++
    }

    // Request 1: OK
    limiter(req, res, next)
    expect(nextCalled).toBe(1)

    // Request 2: OK
    limiter(req, res, next)
    expect(nextCalled).toBe(2)

    // Request 3: Blocked (429)
    limiter(req, res, next)
    expect(nextCalled).toBe(2) // next not called
    expect(status).toBe(429)
    expect(body.error).toBe('Rate limit exceeded')
  })
})
