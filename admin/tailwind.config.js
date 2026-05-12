/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#f4f7f6',
          100: '#e3ebe7',
          200: '#c2d1cb',
          300: '#9db4ae',
          400: '#76968f',
          500: '#10b981', // Keep mid-tone buttons emerald so they pop
          600: '#059669', // Institutional Green
          700: '#334c46', // Very soft sage shadows
          800: '#2b3f3a',
          900: '#243431',
          950: '#111816', // Sleek, dark sage-slate
        },
        secondary: {
          50: '#fff5f5',
          100: '#ffe3e3',
          200: '#ffc9c9',
          300: '#ffa8a8',
          400: '#ff8787',
          500: '#ff6b6b',
          600: '#fa5252',
          700: '#e03131',
          800: '#c92a2a',
          900: '#b02525',
          950: '#8c1515',
        },
        accent: {
          50: '#fff9db',
          100: '#fff3bf',
          200: '#ffec99',
          300: '#ffe066',
          400: '#ffd43b',
          500: '#fcc419',
          600: '#fab005',
          700: '#f59f00',
          800: '#f08c00',
          900: '#e67700',
          950: '#b35c00',
        },
      },
    },
  },
  plugins: [],
}
