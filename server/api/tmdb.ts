import { NormalizedMovie, SearchParams, DiscoverParams, MovieListResult, GenreItem } from './types'
import { SimpleCache } from './cache'
import { searchOmdb, isOmdbConfigured } from './omdb'
import { loadEnv } from '../env'

loadEnv()

export const tmdbCache = new SimpleCache<any>(10 * 60 * 1000, 500)

export const DEFAULT_TMDB_GENRES: Record<number, string> = {
  28: 'Action',
  12: 'Adventure',
  16: 'Animation',
  35: 'Comedy',
  80: 'Crime',
  99: 'Documentary',
  18: 'Drama',
  10751: 'Family',
  14: 'Fantasy',
  36: 'History',
  27: 'Horror',
  10402: 'Music',
  9648: 'Mystery',
  10749: 'Romance',
  878: 'Science Fiction',
  10770: 'TV Movie',
  53: 'Thriller',
  10752: 'War',
  37: 'Western',
}

export function isTmdbConfigured(): boolean {
  const key = process.env.TMDB_API_KEY
  return !!key && key.trim() !== '' && key !== 'your_api_key_here'
}

export function normalizeTmdbMovie(
  item: any,
  genreMap: Record<number, string> = DEFAULT_TMDB_GENRES
): NormalizedMovie {
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
  const dateStr = item.release_date || item.first_air_date
  if (dateStr && typeof dateStr === 'string') {
    const y = parseInt(dateStr.slice(0, 4), 10)
    if (!isNaN(y)) year = y
  } else if (typeof item.year === 'number' && !isNaN(item.year)) {
    year = item.year
  }

  const genres: string[] = []
  if (Array.isArray(item.genre_ids)) {
    for (const id of item.genre_ids) {
      const name = genreMap[id]
      if (name) genres.push(name)
    }
  } else if (Array.isArray(item.genres)) {
    for (const g of item.genres) {
      if (typeof g === 'string') genres.push(g)
      else if (g && typeof g.name === 'string') genres.push(g.name)
    }
  }

  const posterBase = (process.env.TMDB_IMAGE_BASE_URL || 'https://image.tmdb.org/t/p').replace(/\/+$/, '')
  const posterUrl = item.poster_path ? `${posterBase}/w500${item.poster_path}` : null

  let rating: number | null = null
  const vote = item.vote_average ?? item.rating
  if (typeof vote === 'number' && !isNaN(vote)) {
    rating = Math.round(vote * 10) / 10
  }

  return {
    id: String(item.id ?? '').trim(),
    title: String(item.title || item.name || '').trim(),
    year,
    genres,
    posterUrl,
    overview: String(item.overview || '').trim(),
    rating,
  }
}

export async function getTmdbGenres(): Promise<GenreItem[]> {
  const cacheKey = 'tmdb:genres'
  const cached = tmdbCache.get(cacheKey)
  if (cached) return cached

  if (!isTmdbConfigured()) {
    const fallbackList = Object.entries(DEFAULT_TMDB_GENRES).map(([id, name]) => ({
      id: Number(id),
      name,
    }))
    return fallbackList
  }

  const baseUrl = (process.env.TMDB_BASE_URL || 'https://api.themoviedb.org/3').replace(/\/+$/, '')
  const apiKey = process.env.TMDB_API_KEY
  const url = `${baseUrl}/genre/movie/list?api_key=${apiKey}`

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1500) })
    if (!res.ok) throw new Error(`TMDB genre fetch failed with status: ${res.status}`)
    const data = (await res.json()) as any
    if (data && Array.isArray(data.genres)) {
      tmdbCache.set(cacheKey, data.genres)
      return data.genres
    }
  } catch (err) {
    // Fail gracefully
  }

  return Object.entries(DEFAULT_TMDB_GENRES).map(([id, name]) => ({
    id: Number(id),
    name,
  }))
}

export async function searchTmdb(params: SearchParams): Promise<MovieListResult> {
  if (!isTmdbConfigured()) {
    throw new Error('TMDB_API_KEY is not configured')
  }

  const page = params.page && params.page > 0 ? params.page : 1
  const cacheKey = `tmdb:search:${params.query}:${params.year ?? ''}:${params.genre ?? ''}:${page}`
  const cached = tmdbCache.get(cacheKey)
  if (cached) return cached

  const baseUrl = (process.env.TMDB_BASE_URL || 'https://api.themoviedb.org/3').replace(/\/+$/, '')
  const apiKey = process.env.TMDB_API_KEY
  let url = `${baseUrl}/search/movie?api_key=${apiKey}&query=${encodeURIComponent(params.query)}&page=${page}`
  if (params.year) {
    url += `&primary_release_year=${params.year}`
  }

  const res = await fetch(url, { signal: AbortSignal.timeout(1500) })
  if (!res.ok) {
    throw new Error(`TMDB search failed with status: ${res.status}`)
  }
  const data = (await res.json()) as any

  const genresList = await getTmdbGenres()
  const genreMap = genresList.reduce<Record<number, string>>((acc, g) => {
    acc[Number(g.id)] = g.name
    return acc
  }, { ...DEFAULT_TMDB_GENRES })

  let results: NormalizedMovie[] = (data.results || []).map((item: any) =>
    normalizeTmdbMovie(item, genreMap)
  )

  if (params.genre) {
    const filter = params.genre.toLowerCase()
    results = results.filter((m) =>
      m.genres.some((g) => g.toLowerCase() === filter || g.toLowerCase().includes(filter))
    )
  }

  const result: MovieListResult = {
    results,
    page: data.page || page,
    total_pages: data.total_pages || 1,
    total_results: data.total_results || results.length,
  }

  tmdbCache.set(cacheKey, result)
  return result
}

export async function getMoviesTmdb(params: DiscoverParams): Promise<MovieListResult> {
  if (!isTmdbConfigured()) {
    throw new Error('TMDB_API_KEY is not configured')
  }

  const page = params.page && params.page > 0 ? params.page : 1
  const cacheKey = `tmdb:discover:${params.genre ?? ''}:${page}`
  const cached = tmdbCache.get(cacheKey)
  if (cached) return cached

  const baseUrl = (process.env.TMDB_BASE_URL || 'https://api.themoviedb.org/3').replace(/\/+$/, '')
  const apiKey = process.env.TMDB_API_KEY
  const genresList = await getTmdbGenres()
  const genreMap = genresList.reduce<Record<number, string>>((acc, g) => {
    acc[Number(g.id)] = g.name
    return acc
  }, { ...DEFAULT_TMDB_GENRES })

  let genreId: number | undefined
  if (params.genre) {
    const found = genresList.find(
      (g) => g.name.toLowerCase() === params.genre?.toLowerCase() || String(g.id) === params.genre
    )
    if (found) genreId = Number(found.id)
  }

  let url = `${baseUrl}/discover/movie?api_key=${apiKey}&page=${page}&sort_by=popularity.desc`
  if (genreId) {
    url += `&with_genres=${genreId}`
  }

  const res = await fetch(url, { signal: AbortSignal.timeout(1500) })
  if (!res.ok) {
    throw new Error(`TMDB discover failed with status: ${res.status}`)
  }
  const data = (await res.json()) as any
  const results: NormalizedMovie[] = (data.results || []).map((item: any) =>
    normalizeTmdbMovie(item, genreMap)
  )

  const result: MovieListResult = {
    results,
    page: data.page || page,
    total_pages: data.total_pages || 1,
    total_results: data.total_results || results.length,
  }

  tmdbCache.set(cacheKey, result)
  return result
}

/**
 * Searches movies using TMDB, falling back to OMDb if TMDB fails or is not configured.
 * Fails gracefully if both are missing.
 */
export async function searchMovies(params: SearchParams): Promise<MovieListResult> {
  if (isTmdbConfigured()) {
    try {
      return await searchTmdb(params)
    } catch (err: any) {
      console.warn('TMDB search failed, falling back to OMDb:', err?.message || err)
    }
  }

  if (isOmdbConfigured()) {
    try {
      return await searchOmdb(params)
    } catch (err: any) {
      console.warn('OMDb search fallback failed:', err?.message || err)
    }
  }

  // Graceful fallback when neither is configured or both fail
  return {
    results: [],
    page: params.page || 1,
    total_pages: 0,
    total_results: 0,
    warning: 'No movie provider configured or providers temporarily unavailable',
  }
}

/**
 * Discovers/browses movies, falling back to OMDb if TMDB is not available.
 */
export async function getMovies(params: DiscoverParams): Promise<MovieListResult> {
  if (isTmdbConfigured()) {
    try {
      return await getMoviesTmdb(params)
    } catch (err: any) {
      console.warn('TMDB discover failed, falling back to OMDb:', err?.message || err)
    }
  }

  if (isOmdbConfigured()) {
    try {
      return await searchOmdb({
        query: params.genre || 'movie',
        genre: params.genre,
        page: params.page || 1,
      })
    } catch (err: any) {
      console.warn('OMDb fallback failed:', err?.message || err)
    }
  }

  return {
    results: [],
    page: params.page || 1,
    total_pages: 0,
    total_results: 0,
    warning: 'No movie provider configured or providers temporarily unavailable',
  }
}
