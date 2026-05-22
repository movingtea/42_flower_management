import type { WechatProduct } from "@/types";

export const mockProducts: WechatProduct[] = [
  {
    id: "prod-001",
    name: "经典红玫瑰束",
    price: 198,
    imageUrl: "/images/rose-bouquet.jpg",
    stock: 50,
    category: "花束",
    description: "11支红玫瑰，精美包装，适合表白与纪念日。",
  },
  {
    id: "prod-002",
    name: "清新向日葵花篮",
    price: 168,
    imageUrl: "/images/sunflower-basket.jpg",
    stock: 30,
    category: "花篮",
    description: "3支向日葵搭配绿植，阳光活力之选。",
  },
  {
    id: "prod-003",
    name: "温柔粉百合礼盒",
    price: 258,
    imageUrl: "/images/lily-box.jpg",
    stock: 20,
    category: "礼盒",
    description: "6支粉百合，高雅礼盒装，送礼体面。",
  },
];
