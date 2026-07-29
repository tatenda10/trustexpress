import { Component } from 'react'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('[admin] render error', error, info?.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <section className="border border-red-300 bg-red-50 p-6">
        <h2 className="text-base font-semibold text-red-800">This page failed to load</h2>
        <p className="mt-1 text-sm text-red-700">
          {this.state.error?.message || 'An unexpected error occurred while rendering this page.'}
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="border border-red-600 bg-red-600 px-4 py-2 text-sm font-semibold text-white"
          >
            Try again
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-700"
          >
            Reload
          </button>
        </div>
      </section>
    )
  }
}
