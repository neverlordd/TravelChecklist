/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: '#F3F5F4',
        surface: '#FFFFFF',
        ink: '#17211F',
        muted: '#6B7774',
        mint: {
          50: '#F0FDFA',
          100: '#CCFBF1',
          200: '#99F6E4',
          400: '#2DD4BF',
          500: '#14B8A6',
          600: '#0D9488',
          700: '#0F766E'
        }
      },
      boxShadow: {
        soft: '0 8px 30px rgba(15, 118, 110, 0.08)'
      },
      fontFamily: {
        sans: ['Manrope Variable', 'Manrope', 'ui-sans-serif', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif']
      }
    }
  },
  plugins: []
}
