import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// GET /api/leads - Fetch all leads with optional filtering/sorting
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const sortBy = searchParams.get('sortBy') || 'createdAt';
    const sortOrder = searchParams.get('sortOrder') || 'desc';
    const status = searchParams.get('status') || '';
    const search = searchParams.get('search') || '';
    const category = searchParams.get('category') || '';

    // Build where clause
    const where: any = {};

    if (status) {
      where.status = status;
    }

    if (category) {
      where.category = { contains: category };
    }

    if (search) {
      where.OR = [
        { name: { contains: search } },
        { email: { contains: search } },
        { phone: { contains: search } },
        { address: { contains: search } },
        { website: { contains: search } },
        { category: { contains: search } },
      ];
    }

    // Build order by
    const orderDir = sortOrder === 'asc' ? 'asc' : 'desc';
    let orderBy: any = { createdAt: orderDir };

    if (sortBy === 'name') orderBy = { name: orderDir };
    else if (sortBy === 'email') orderBy = { email: orderDir };
    else if (sortBy === 'phone') orderBy = { phone: orderDir };
    else if (sortBy === 'address') orderBy = { address: orderDir };
    else if (sortBy === 'website') orderBy = { website: orderDir };
    else if (sortBy === 'category') orderBy = { category: orderDir };
    else if (sortBy === 'rating') orderBy = { rating: orderDir };
    else if (sortBy === 'priorityScore') orderBy = { priorityScore: orderDir };
    else if (sortBy === 'status') orderBy = { status: orderDir };
    else if (sortBy === 'createdAt') orderBy = { createdAt: orderDir };
    else if (sortBy === 'updatedAt') orderBy = { updatedAt: orderDir };

    const leads = await db.lead.findMany({
      where,
      orderBy,
    });

    return NextResponse.json({
      success: true,
      leads,
      count: leads.length,
    });
  } catch (error) {
    console.error('Error fetching leads:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

// POST /api/leads - Add one or more leads
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { leads } = body;

    if (!leads || !Array.isArray(leads) || leads.length === 0) {
      return NextResponse.json(
        { success: false, error: 'leads array is required' },
        { status: 400 }
      );
    }

    // Check for duplicates by email+phone+name combination
    const created: any[] = [];
    const skipped: any[] = [];

    for (const lead of leads) {
      // Check if lead already exists (by email or name+phone combo)
      const orConditions: any[] = [
        {
          name: lead.name,
          phone: lead.phone || '',
        },
      ];
      if (lead.email) {
        orConditions.push({ email: lead.email });
      }
      const existing = await db.lead.findFirst({
        where: {
          OR: orConditions,
        },
      });

      if (existing) {
        skipped.push({ name: lead.name, email: lead.email, phone: lead.phone, reason: 'duplicate', existingId: existing.id });
        continue;
      }

      const newLead = await db.lead.create({
        data: {
          name: lead.name || '',
          address: lead.address || '',
          phone: lead.phone || '',
          website: lead.website || '',
          email: lead.email || '',
          rating: lead.rating || '',
          reviewsCount: lead.reviews_count || lead.reviewsCount || '',
          category: lead.category || '',
          source: lead.source || 'Google Maps',
          sourceUrl: lead.source_url || lead.sourceUrl || '',
          priorityScore: lead.priority_score || lead.priorityScore || 0,
          status: 'new',
        },
      });

      created.push(newLead as any);
    }

    return NextResponse.json({
      success: true,
      created: created.length,
      skipped: skipped.length,
      leads: created,
      duplicates: skipped,
    });
  } catch (error) {
    console.error('Error creating leads:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

// DELETE /api/leads - Delete one or more leads
export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { ids } = body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json(
        { success: false, error: 'ids array is required' },
        { status: 400 }
      );
    }

    const result = await db.lead.deleteMany({
      where: {
        id: { in: ids },
      },
    });

    return NextResponse.json({
      success: true,
      deleted: result.count,
    });
  } catch (error) {
    console.error('Error deleting leads:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

// PATCH /api/leads - Update a lead
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, ...data } = body;

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'id is required' },
        { status: 400 }
      );
    }

    const lead = await db.lead.update({
      where: { id },
      data,
    });

    return NextResponse.json({
      success: true,
      lead,
    });
  } catch (error) {
    console.error('Error updating lead:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
