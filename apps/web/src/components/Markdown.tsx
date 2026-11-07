import type { MouseEvent } from 'react'
import { useNavigate } from 'react-router-dom'

/**
 * Renders the server-produced HTML for a wiki page. The server rewrites
 * `[[wiki-links]]` to `/page/...` URLs; intercept those clicks so internal
 * navigation stays client-side while external links behave normally.
 */
export function Markdown({ html }: { html: string }) {
  const navigate = useNavigate()

  function handleClick(event: MouseEvent<HTMLDivElement>) {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return
    }
    const anchor = (event.target as HTMLElement).closest('a')
    if (!anchor) return
    const href = anchor.getAttribute('href') ?? ''
    if (!href.startsWith('/') || href.startsWith('//')) return
    event.preventDefault()
    navigate(href)
  }

  return (
    <div
      className="wiki-prose"
      onClick={handleClick}
      // Content is authored locally and rendered by the same `marked` pipeline
      // the CLI already uses; this view is read-only and never accepts input.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
