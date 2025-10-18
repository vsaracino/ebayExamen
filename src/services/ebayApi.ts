import axios, { AxiosResponse } from 'axios';
import { EbaySearchResponse, SearchParams } from '../types/ebay';

// eBay API Configuration
const EBAY_API_BASE_URL = 'https://svcs.ebay.com/services/search/FindingService/v1';
const EBAY_APP_ID = process.env.REACT_APP_EBAY_APP_ID || 'YOUR_EBAY_APP_ID';

class EbayApiService {
  private baseURL: string;
  private appId: string;

  constructor() {
    this.baseURL = EBAY_API_BASE_URL;
    this.appId = EBAY_APP_ID;
  }

  /**
   * Search for items on eBay
   */
  async searchItems(params: SearchParams): Promise<EbaySearchResponse> {
    try {
      const searchParams = this.buildSearchParams(params);
      const response: AxiosResponse<EbaySearchResponse> = await axios.get(
        `${this.baseURL}?${searchParams}`,
        {
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      return response.data;
    } catch (error) {
      console.error('Error searching eBay items:', error);
      throw new Error('Failed to search eBay items. Please try again.');
    }
  }

  /**
   * Build query parameters for eBay API
   */
  private buildSearchParams(params: SearchParams): string {
    const searchParams = new URLSearchParams();
    
    // Required parameters
    searchParams.append('OPERATION-NAME', 'findItemsAdvanced');
    searchParams.append('SERVICE-VERSION', '1.0.0');
    searchParams.append('SECURITY-APPNAME', this.appId);
    searchParams.append('RESPONSE-DATA-FORMAT', 'JSON');
    searchParams.append('REST-PAYLOAD', 'true');
    
    // Search parameters
    searchParams.append('keywords', params.keywords);
    
    if (params.categoryId) {
      searchParams.append('categoryId', params.categoryId);
    }
    
    if (params.minPrice !== undefined) {
      searchParams.append('itemFilter(0).name', 'MinPrice');
      searchParams.append('itemFilter(0).value', params.minPrice.toString());
    }
    
    if (params.maxPrice !== undefined) {
      const filterIndex = params.minPrice !== undefined ? 1 : 0;
      searchParams.append(`itemFilter(${filterIndex}).name`, 'MaxPrice');
      searchParams.append(`itemFilter(${filterIndex}).value`, params.maxPrice.toString());
    }
    
    if (params.condition) {
      const filterIndex = this.getNextFilterIndex(params);
      searchParams.append(`itemFilter(${filterIndex}).name`, 'Condition');
      searchParams.append(`itemFilter(${filterIndex}).value`, params.condition);
    }
    
    if (params.sortOrder) {
      searchParams.append('sortOrder', params.sortOrder);
    }
    
    // Pagination
    if (params.pageNumber) {
      searchParams.append('paginationInput.pageNumber', params.pageNumber.toString());
    }
    
    if (params.entriesPerPage) {
      searchParams.append('paginationInput.entriesPerPage', params.entriesPerPage.toString());
    }

    return searchParams.toString();
  }

  /**
   * Get the next available filter index
   */
  private getNextFilterIndex(params: SearchParams): number {
    let index = 0;
    if (params.minPrice !== undefined) index++;
    if (params.maxPrice !== undefined) index++;
    return index;
  }

  /**
   * Get item details by item ID
   */
  async getItemDetails(itemId: string): Promise<any> {
    try {
      const response = await axios.get(
        `${this.baseURL}?OPERATION-NAME=getItem&ITEM-ID=${itemId}&SERVICE-VERSION=1.0.0&SECURITY-APPNAME=${this.appId}&RESPONSE-DATA-FORMAT=JSON`
      );
      return response.data;
    } catch (error) {
      console.error('Error getting item details:', error);
      throw new Error('Failed to get item details. Please try again.');
    }
  }

  /**
   * Get popular categories
   */
  async getCategories(): Promise<any> {
    try {
      const response = await axios.get(
        `${this.baseURL}?OPERATION-NAME=getCategoryInfo&SERVICE-VERSION=1.0.0&SECURITY-APPNAME=${this.appId}&RESPONSE-DATA-FORMAT=JSON`
      );
      return response.data;
    } catch (error) {
      console.error('Error getting categories:', error);
      throw new Error('Failed to get categories. Please try again.');
    }
  }
}

// Export singleton instance
export const ebayApiService = new EbayApiService();
export default ebayApiService;

