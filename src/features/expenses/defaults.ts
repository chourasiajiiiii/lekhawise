import type { IconName } from '@/core/ui';

import type { AccountType, CategoryType } from './types';

export const DEFAULT_ACCOUNTS: { id: string; name: string; type: AccountType; icon: IconName; color: string }[] = [
  { id: 'acc_cash', name: 'Cash', type: 'cash', icon: 'cash-outline', color: '#22C55E' },
  { id: 'acc_bank', name: 'Bank account', type: 'bank', icon: 'business-outline', color: '#3B82F6' },
];

export const DEFAULT_CATEGORIES: { id: string; name: string; type: CategoryType; icon: IconName; color: string }[] = [
  { id: 'cat_food', name: 'Food & dining', type: 'expense', icon: 'restaurant-outline', color: '#F97316' },
  { id: 'cat_groceries', name: 'Groceries', type: 'expense', icon: 'cart-outline', color: '#84CC16' },
  { id: 'cat_transport', name: 'Transport', type: 'expense', icon: 'car-outline', color: '#3B82F6' },
  { id: 'cat_shopping', name: 'Shopping', type: 'expense', icon: 'bag-handle-outline', color: '#EC4899' },
  { id: 'cat_bills', name: 'Bills & utilities', type: 'expense', icon: 'receipt-outline', color: '#F59E0B' },
  { id: 'cat_rent', name: 'Rent & home', type: 'expense', icon: 'home-outline', color: '#8B5CF6' },
  { id: 'cat_health', name: 'Health', type: 'expense', icon: 'medkit-outline', color: '#EF4444' },
  { id: 'cat_entertainment', name: 'Entertainment', type: 'expense', icon: 'film-outline', color: '#6366F1' },
  { id: 'cat_education', name: 'Education', type: 'expense', icon: 'school-outline', color: '#06B6D4' },
  { id: 'cat_travel', name: 'Travel', type: 'expense', icon: 'airplane-outline', color: '#14B8A6' },
  { id: 'cat_personal', name: 'Personal care', type: 'expense', icon: 'sparkles-outline', color: '#A855F7' },
  { id: 'cat_gifts_out', name: 'Gifts & donations', type: 'expense', icon: 'gift-outline', color: '#F43F5E' },
  { id: 'cat_other_out', name: 'Other', type: 'expense', icon: 'ellipsis-horizontal-outline', color: '#64748B' },
  { id: 'cat_salary', name: 'Salary', type: 'income', icon: 'briefcase-outline', color: '#22C55E' },
  { id: 'cat_business', name: 'Business', type: 'income', icon: 'storefront-outline', color: '#14B8A6' },
  { id: 'cat_freelance', name: 'Freelance', type: 'income', icon: 'laptop-outline', color: '#3B82F6' },
  { id: 'cat_interest', name: 'Interest & dividends', type: 'income', icon: 'trending-up-outline', color: '#84CC16' },
  { id: 'cat_gifts_in', name: 'Gifts received', type: 'income', icon: 'gift-outline', color: '#EC4899' },
  { id: 'cat_refund', name: 'Refunds', type: 'income', icon: 'return-down-back-outline', color: '#06B6D4' },
  { id: 'cat_other_in', name: 'Other', type: 'income', icon: 'ellipsis-horizontal-outline', color: '#64748B' },
];

/** Categories added in schema v2, for loan interest and balance corrections when reconciling. */
export const V2_CATEGORIES: { id: string; name: string; type: CategoryType; icon: IconName; color: string }[] = [
  { id: 'cat_loan_interest', name: 'Loan interest', type: 'expense', icon: 'trending-down-outline', color: '#DC2626' },
  { id: 'cat_adjust_out', name: 'Balance adjustment', type: 'expense', icon: 'construct-outline', color: '#94A3B8' },
  { id: 'cat_adjust_in', name: 'Balance adjustment', type: 'income', icon: 'construct-outline', color: '#94A3B8' },
];

export const LOAN_INTEREST_CATEGORY_ID = 'cat_loan_interest';
export const INTEREST_INCOME_CATEGORY_ID = 'cat_interest';
export const ADJUST_OUT_CATEGORY_ID = 'cat_adjust_out';
export const ADJUST_IN_CATEGORY_ID = 'cat_adjust_in';

/** Icons offered when creating a category or account. */
export const ICON_CHOICES: IconName[] = [
  'restaurant-outline', 'cafe-outline', 'fast-food-outline', 'cart-outline', 'basket-outline',
  'car-outline', 'bus-outline', 'train-outline', 'bicycle-outline', 'airplane-outline',
  'bag-handle-outline', 'shirt-outline', 'pricetag-outline', 'receipt-outline', 'flash-outline',
  'water-outline', 'wifi-outline', 'phone-portrait-outline', 'tv-outline', 'home-outline',
  'construct-outline', 'medkit-outline', 'fitness-outline', 'heart-outline', 'paw-outline',
  'film-outline', 'game-controller-outline', 'musical-notes-outline', 'book-outline', 'school-outline',
  'happy-outline', 'sparkles-outline', 'gift-outline', 'people-outline', 'briefcase-outline',
  'storefront-outline', 'laptop-outline', 'trending-up-outline', 'cash-outline', 'card-outline',
  'wallet-outline', 'business-outline', 'shield-checkmark-outline', 'umbrella-outline', 'leaf-outline',
  'globe-outline', 'return-down-back-outline', 'ellipsis-horizontal-outline', 'flag-outline', 'trophy-outline',
  'rocket-outline', 'diamond-outline', 'key-outline', 'medal-outline', 'person-outline', 'hammer-outline',
];
