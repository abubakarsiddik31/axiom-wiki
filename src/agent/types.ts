export type CoreMessage = {
  role: 'user'
  content: string | Array<{ type: string; [k: string]: unknown }>
}
