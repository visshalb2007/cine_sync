import { NormalizedMovie, SearchParams, MovieListResult } from './types'
import { SimpleCache } from './cache'
import { loadEnv } from '../env'

loadEnv()

export const omdbCache = new SimpleCache<any>(10 * 60 * 1000, 500)

export function isOmdbConfigured(): boolean {
  const key = process.env.OMDB_API_KEY
  return !!key && key.trim() !== '' && key !== 'your_api_key_here'
}

export function normalizeOmdbMovie(item: any): NormalizedMovie {
  if (!item || typeof item !== 'object') {
    return {
      id: '',
      title: '',
      year: null,
      genres: [],
      posterUrl: null,
      overview: '',
      rating: null,
    }
  }

  let year: number | null = null
  const yearStr = item.Year || item.year
  if (yearStr && typeof yearStr === 'string') {
    const match = yearStr.match(/\b(18|19|20)\d{2}\b/)
    if (match) {
      year = parseInt(match[0], 10)
    }
  } else if (typeof yearStr === 'number' && !isNaN(yearStr)) {
    year = yearStr
  }

  const genreRaw = item.Genre || item.genre
  const genres: string[] =
    typeof genreRaw === 'string' && genreRaw !== 'N/A'
      ? genreRaw.split(',').map((s: string) => s.trim()).filter(Boolean)
      : Array.isArray(item.genres)
      ? item.genres.map(String)
      : []

  const posterRaw = item.Poster || item.poster
  const posterUrl =
    typeof posterRaw === 'string' && posterRaw !== 'N/A' && /^https?:\/\//i.test(posterRaw)
      ? posterRaw
      : null

  let rating: number | null = null
  const ratingRaw = item.imdbRating ?? item.rating
  if (ratingRaw !== undefined && ratingRaw !== null && ratingRaw !== 'N/A') {
    const parsed = typeof ratingRaw === 'number' ? ratingRaw : parseFloat(String(ratingRaw))
    if (!isNaN(parsed)) rating = Math.round(parsed * 10) / 10
  }

  const overviewRaw = item.Plot || item.overview || ''
  const overview =
    typeof overviewRaw === 'string' && overviewRaw !== 'N/A' ? overviewRaw.trim() : ''

  return {
    id: String(item.imdbID || item.id || '').trim(),
    title: String(item.Title || item.title || '').trim(),
    year,
    genres,
    posterUrl,
    overview,
    rating,
  }
}

export async function getOmdbMovieDetail(imdbId: string): Promise<any | null> {
  const cacheKey = `omdb:detail:${imdbId}`
  const cached = omdbCache.get(cacheKey)
  if (cached) return cached

  if (!isOmdbConfigured()) return null

  const baseUrl = (process.env.OMDB_BASE_URL || 'https://www.omdbapi.com').replace(/\/+$/, '')
  const apiKey = process.env.OMDB_API_KEY
  const url = `${baseUrl}/?apikey=${apiKey}&i=${encodeURIComponent(imdbId)}&plot=short`

  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const data = (await res.json()) as any
    if (data && data.Response !== 'False') {
      omdbCache.set(cacheKey, data)
      return data
    }
  } catch (e) {
    // Fail gracefully
  }
  return null
}

export async function searchOmdb(params: SearchParams): Promise<MovieListResult> {
  if (!isOmdbConfigured()) {
    throw new Error('OMDB_API_KEY is not configured')
  }

  const page = params.page && params.page > 0 ? params.page : 1
  const cacheKey = `omdb:search:${params.query}:${params.year ?? ''}:${params.genre ?? ''}:${page}`
  const cached = omdbCache.get(cacheKey)
  if (cached) return cached

  const baseUrl = (process.env.OMDB_BASE_URL || 'https://www.omdbapi.com').replace(/\/+$/, '')
  const apiKey = process.env.OMDB_API_KEY
  let url = `${baseUrl}/?apikey=${apiKey}&s=${encodeURIComponent(params.query)}&page=${page}&type=movie`
  if (params.year) {
    url += `&y=${params.year}`
  }

  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`OMDb search failed with status: ${res.status}`)
  }
  const data = (await res.json()) as any
  if (data.Response === 'False') {
    const emptyResult: MovieListResult = { results: [], page, total_pages: 0, total_results: 0 }
    omdbCache.set(cacheKey, emptyResult)
    return emptyResult
  }

  const rawList: any[] = data.Search || []

  // Concurrently enrich up to 10 results with detailed plots, ratings, and genres
  const enriched = await Promise.all(
    rawList.slice(0, 10).map(async (item) => {
      if (item.imdbID) {
        const detail = await getOmdbMovieDetail(item.imdbID)
        if (detail) {
          return { ...item, ...detail }
        }
      }
      return item
    })
  )

  let results = enriched.map(normalizeOmdbMovie)

  if (params.genre) {
    const filter = params.genre.toLowerCase()
    results = results.filter((m) =>
      m.genres.some((g) => g.toLowerCase() === filter || g.toLowerCase().includes(filter))
    )
  }

  const totalResults = parseInt(data.totalResults || '0', 10) || results.length
  const totalPages = Math.max(1, Math.ceil(totalResults / 10))

  const result: MovieListResult = {
    results,
    page,
    total_pages: totalPages,
    total_results: totalResults,
  }

  omdbCache.set(cacheKey, result)
  return result
}
