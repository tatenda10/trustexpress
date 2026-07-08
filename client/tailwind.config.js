/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./App.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}", "./screens/**/*.{js,jsx,ts,tsx}", "./navigation/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],

  theme: {
    extend: {
      colors: {
        primary: '#206EFF',
      },
      // App-wide font bump: every Tailwind text-* size is enlarged ~15% so all
      // text rendered via NativeWind classes is bigger without touching screens.
      fontSize: {
        xs: ['13px', '18px'],
        sm: ['15px', '21px'],
        base: ['18px', '26px'],
        lg: ['20px', '28px'],
        xl: ['23px', '30px'],
        '2xl': ['27px', '34px'],
        '3xl': ['34px', '40px'],
        '4xl': ['40px', '46px'],
        '5xl': ['52px', '56px'],
        '6xl': ['64px', '68px'],
      },
    },
  },
  plugins: [],
}

