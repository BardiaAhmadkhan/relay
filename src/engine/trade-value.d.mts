export type Preferences = { size?: string; fit?: string; riding?: string };
export type Profile = {
  eligible: boolean;
  category: string;
  brand?: string;
  model?: string;
  size?: string;
  styles?: string[];
  fabric?: string[];
};
export type CatalogProduct = {
  handle: string;
  title: string;
  url: string | null;
  image: string | null;
  brand: string;
  category: string;
  type: string;
  fabric: string[];
  styles: string[];
  cut: string;
  currency: string;
  variants: {
    id: string;
    title?: string;
    price: number;
    available: boolean;
    size: string;
    length: string;
  }[];
};
export type Catalog = {
  origin: string;
  currency: string;
  updated: string;
  products: CatalogProduct[];
  variantCount: number;
};
export type Rates = {
  buyRate: number | null;
  resaleRatio: number | null;
  creditPremium: number | null;
};
export type Match = {
  handle: string;
  title: string;
  url: string | null;
  image: string | null;
  price: number;
  variant: string;
  size: string;
  reasons: string[];
  score: number;
};
export type Offer = {
  kind: string;
  reason: string;
  retail: { low: number; mid: number; high: number } | null;
  used: number | null;
  credit: number | null;
  basis: string | null;
  comparables: { title: string; url: string | null; price: number }[];
  recommendations: Match[];
};
export function tradeOffer(p: Profile, c: Catalog, t: Rates | null, prefs?: Preferences): Offer;
export function signedProfile(value: unknown): Profile;
export function categoryKey(s: string): string;
export function garmentSize(s: string): string;
