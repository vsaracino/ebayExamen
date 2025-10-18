# eBay Search App

A modern React TypeScript application for searching and browsing eBay listings with a beautiful, responsive interface.

## Features

- 🔍 **Advanced Search**: Search eBay listings with keywords, categories, price ranges, and conditions
- 🎨 **Modern UI**: Clean, responsive design with styled-components
- 📱 **Mobile Friendly**: Fully responsive design that works on all devices
- ⚡ **Fast Performance**: Optimized with React Query for efficient data fetching
- 🔧 **TypeScript**: Full type safety throughout the application
- 🎯 **Smart Filtering**: Filter by category, price range, condition, and sort options
- 📄 **Pagination**: Navigate through search results with pagination
- 🖼️ **Rich Item Cards**: Detailed item information with images, prices, and auction details

## Getting Started

### Prerequisites

- Node.js (version 14 or higher)
- npm or yarn
- eBay Developer Account (for API access)

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd ebay-search-app
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up eBay API credentials**
   - Get your eBay App ID from [eBay Developer Portal](https://developer.ebay.com/my/keys)
   - Copy `.env.example` to `.env`
   - Add your eBay App ID to the `.env` file:
     ```
     REACT_APP_EBAY_APP_ID=your_ebay_app_id_here
     ```

4. **Start the development server**
   ```bash
   npm start
   ```

5. **Open your browser**
   Navigate to `http://localhost:3000`

## Project Structure

```
src/
├── components/          # React components
│   ├── SearchForm.tsx   # Search form with filters
│   ├── SearchResults.tsx # Results display and pagination
│   └── ItemCard.tsx     # Individual item card
├── services/            # API services
│   └── ebayApi.ts       # eBay API integration
├── types/               # TypeScript type definitions
│   └── ebay.ts          # eBay API and app types
├── utils/               # Utility functions
│   ├── formatters.ts    # Data formatting utilities
│   └── constants.ts     # App constants
├── App.tsx              # Main application component
└── index.tsx            # Application entry point
```

## Available Scripts

- `npm start` - Start development server
- `npm build` - Build for production
- `npm test` - Run tests
- `npm run lint` - Run ESLint
- `npm run lint:fix` - Fix ESLint errors

## API Configuration

This app uses the eBay Finding API. To get started:

1. Visit the [eBay Developer Portal](https://developer.ebay.com/)
2. Create a developer account
3. Create a new application
4. Get your App ID
5. Add it to your `.env` file

## Features Overview

### Search Functionality
- **Keyword Search**: Search for any item on eBay
- **Category Filtering**: Filter by popular categories
- **Price Range**: Set minimum and maximum prices
- **Condition Filter**: Filter by item condition (New, Used, etc.)
- **Sort Options**: Sort by price, time, relevance, etc.

### Item Display
- **Rich Cards**: Beautiful item cards with images and details
- **Price Information**: Current price and shipping costs
- **Auction Details**: Time remaining, bid count for auctions
- **Condition Badges**: Visual indicators for item condition
- **Direct Links**: Click to view items on eBay

### Responsive Design
- **Mobile First**: Optimized for mobile devices
- **Grid Layout**: Responsive grid that adapts to screen size
- **Touch Friendly**: Large buttons and touch targets
- **Fast Loading**: Optimized images and lazy loading

## Technologies Used

- **React 18** - Modern React with hooks
- **TypeScript** - Type safety and better development experience
- **Styled Components** - CSS-in-JS styling
- **React Query** - Data fetching and caching
- **Axios** - HTTP client for API requests
- **React Router** - Client-side routing
- **React Hook Form** - Form handling
- **React Hot Toast** - Notifications

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

This project is licensed under the MIT License.## Support

For questions or support, please open an issue on GitHub.



