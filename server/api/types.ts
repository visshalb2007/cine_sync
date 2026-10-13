export interface NormalizedMovie {
  id: string
  title: string
  year: number | null
  genres: string[]
  posterUrl: string | null
  overview: string
  rating: number | null
}

export interface SearchParams {
  query: string
  genre?: string
  year?: number
  page?: number
}

export interface DiscoverParams {
  genre?: string
  page?: number
}

export interface MovieListResult {
  results: NormalizedMovie[]
  page: number
  total_pages?: number
  total_results?: number
  warning?: string
}

export interface GenreItem {
  id: number | string
  name: string
}
