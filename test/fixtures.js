// Realistic-looking listings in the shape the Best Buy Canada search API uses (sku, name, salePrice,
// regularPrice, customerRating, productUrl, thumbnailImage, availability ...). Used by the tests and the demo.

let seq = 0;

export function makeProduct({ sku, name, price, regularPrice, inStock = true, rating = 4.4, ratingCount = 18, extra = {} }) {
  const id = String(sku ?? 19800000 + ++seq);
  return {
    sku: id,
    name,
    salePrice: price,
    regularPrice: regularPrice ?? Math.round(price * 1.3 * 100) / 100,
    saleEndDate: null,
    customerRating: rating,
    customerRatingCount: ratingCount,
    categoryName: 'Gaming Laptops',
    productUrl: `/en-ca/product/${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)}/${id}`,
    thumbnailImage: `https://multimedia.bbycastatic.ca/multimedia/products/150x150/198/${id.slice(0, 5)}/${id}.jpg`,
    highResImage: `https://multimedia.bbycastatic.ca/multimedia/products/500x500/198/${id.slice(0, 5)}/${id}.jpg`,
    isOnlineOnly: false,
    isInStoreOnly: false,
    isClearance: false,
    hasPromotion: false,
    isMarketplace: false,
    availability: {
      shipping: { status: inStock ? 'InStock' : 'OutOfStock', purchasable: inStock },
      pickup: { status: 'OutOfStock', purchasable: false },
      buttonState: inStock ? 'AddToCart' : 'SoldOut',
    },
    ...extra,
  };
}

export const LAPTOPS = {
  asus: makeProduct({
    sku: 19810001,
    name: 'Open Box - ASUS TUF Gaming F15 15.6" 144Hz Gaming Laptop - Graphite Black (Intel Core i7-12700H/16GB RAM/512GB SSD/GeForce RTX 3060)',
    price: 899.99,
    regularPrice: 1299.99,
  }),
  msi: makeProduct({
    sku: 19810002,
    name: 'Geek Squad Certified Open Box - MSI Katana 15 15.6" 144Hz Gaming Laptop (Intel Core i7-13620H/16GB RAM/1TB SSD/GeForce RTX 4060)',
    price: 1199.99,
    regularPrice: 1599.99,
  }),
  lenovo: makeProduct({
    sku: 19810003,
    name: 'Refurbished (Excellent) - Lenovo LOQ 15.6" 144Hz Gaming Laptop (AMD Ryzen 5 7235HS/16GB RAM/512GB SSD/GeForce RTX 3050)',
    price: 749.99,
    regularPrice: 999.99,
    inStock: false,
  }),
  acer: makeProduct({
    sku: 19810004,
    name: 'Open Box - Acer Nitro V 16" 165Hz Gaming Laptop (AMD Ryzen 7 8845HS/16GB RAM/1TB SSD/GeForce RTX 4050)',
    price: 1049.99,
    regularPrice: 1399.99,
  }),
  hp: makeProduct({
    sku: 19810005,
    name: 'Open Box - HP Victus 16.1" 144Hz Gaming Laptop (Intel Core i5-12500H/16GB RAM/512GB SSD/GeForce RTX 3050 Ti)',
    price: 829.99,
    regularPrice: 1099.99,
    extra: { isInStoreOnly: true },
  }),
  alienware: makeProduct({
    sku: 19810006,
    name: 'Open Box - Alienware m16 R2 16" 240Hz Gaming Laptop (Intel Core Ultra 7 155H/32GB RAM/1TB SSD/GeForce RTX 4070)',
    price: 1749.99,
    regularPrice: 2299.99,
    rating: 4.7,
    ratingCount: 9,
  }),
  razer: makeProduct({
    sku: 19810007,
    name: 'Open Box - Razer Blade 14 14" 240Hz Gaming Laptop (AMD Ryzen 9 8945HS/32GB RAM/1TB SSD/GeForce RTX 4060)',
    price: 1599.99,
    regularPrice: 2199.99,
  }),
};

export const detailFor = (sku) => ({
  sku,
  longDescription: '<p>Fast gaming laptop with a high-refresh display and a dedicated GeForce graphics card.</p><p>Includes charger.</p>',
  highlights: ['144Hz refresh rate display', 'Backlit keyboard', 'Wi-Fi 6 and Bluetooth 5.2'],
  specs: [
    { name: 'Processor Model', value: 'Intel Core i7-12700H' },
    { name: 'Graphics Card', value: 'NVIDIA GeForce RTX 3060 6GB' },
    { name: 'Operating System', value: 'Windows 11 Home' },
    { name: 'Weight', value: '2.2 kg (4.85 lbs)' },
  ],
});
