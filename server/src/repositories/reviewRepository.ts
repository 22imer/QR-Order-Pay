import { ReviewModel } from '../models/Review.js';

export interface ReviewListFilters {
  rating?: number;
  from?: Date;
  to?: Date;
  page?: number;
  limit?: number;
}

export const reviewRepository = {
  async create(data: {
    orderId: string;
    tableSessionId: string;
    participantId: string;
    rating: number;
    comment?: string;
  }) {
    return ReviewModel.create(data);
  },
  async findByOrder(orderId: string) {
    return ReviewModel.findOne({ orderId });
  },
  async listByParticipant(tableSessionId: string, participantId: string) {
    return ReviewModel.find({ tableSessionId, participantId })
      .select('orderId rating comment createdAt')
      .lean();
  },
  async listBySession(tableSessionId: string) {
    return ReviewModel.find({ tableSessionId }).sort({ createdAt: -1 });
  },
  async listForAdmin(filters: ReviewListFilters = {}) {
    const match: Record<string, unknown> = {};
    if (filters.rating) match.rating = filters.rating;
    if (filters.from || filters.to) {
      const createdAt: Record<string, Date> = {};
      if (filters.from) createdAt.$gte = filters.from;
      if (filters.to) createdAt.$lt = filters.to;
      match.createdAt = createdAt;
    }
    const page = filters.page && filters.page > 0 ? filters.page : 1;
    const limit = filters.limit && filters.limit > 0 ? Math.min(filters.limit, 50) : 20;
    const [items, summary] = await Promise.all([
      ReviewModel.aggregate([
        { $match: match },
        { $sort: { createdAt: -1 } },
        { $skip: (page - 1) * limit },
        { $limit: limit },
        { $lookup: { from: 'orders', localField: 'orderId', foreignField: '_id', as: 'order' } },
        { $unwind: { path: '$order', preserveNullAndEmptyArrays: true } },
        {
          $lookup: {
            from: 'tables',
            localField: 'order.tableId',
            foreignField: '_id',
            as: 'table',
          },
        },
        { $unwind: { path: '$table', preserveNullAndEmptyArrays: true } },
        {
          $project: {
            rating: 1,
            comment: 1,
            createdAt: 1,
            orderCode: '$order.code',
            orderTotal: '$order.total',
            tableName: '$table.name',
          },
        },
      ]),
      ReviewModel.aggregate([
        { $match: match },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            averageRating: { $avg: '$rating' },
            one: { $sum: { $cond: [{ $eq: ['$rating', 1] }, 1, 0] } },
            two: { $sum: { $cond: [{ $eq: ['$rating', 2] }, 1, 0] } },
            three: { $sum: { $cond: [{ $eq: ['$rating', 3] }, 1, 0] } },
            four: { $sum: { $cond: [{ $eq: ['$rating', 4] }, 1, 0] } },
            five: { $sum: { $cond: [{ $eq: ['$rating', 5] }, 1, 0] } },
          },
        },
      ]),
    ]);
    const stats = summary[0] ?? {
      total: 0,
      averageRating: 0,
      one: 0,
      two: 0,
      three: 0,
      four: 0,
      five: 0,
    };
    const counts: Record<number, number> = {
      1: stats.one,
      2: stats.two,
      3: stats.three,
      4: stats.four,
      5: stats.five,
    };
    return {
      items,
      total: stats.total,
      page,
      limit,
      averageRating: Math.round(stats.averageRating * 100) / 100,
      distribution: [1, 2, 3, 4, 5].map((rating) => ({ rating, count: counts[rating] })),
    };
  },
};
