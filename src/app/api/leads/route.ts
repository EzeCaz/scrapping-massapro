import { NextRequest, NextResponse } from 'next/server';
import { getLibsqlClient } from '@/lib/db-libsql';

// GET /api/leads - Fetch all leads with optional filtering/sorting
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const sortBy = searchParams.get('sortBy') || 'createdAt';
    const sortOrder = searchParams.get('sortOrder') || 'desc';
    const status = searchParams.get('status') || '';
    const search = searchParams.get('search') || '';
    const category = searchParams.get('category') || '';
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '100');
    const offset = (page - 1) * limit;

    const client = getLibsqlClient();

    // Build WHERE clause
    let whereParts: string[] = [];
    let params: any[] = [];

    if (status) {
      whereParts.push('status = ?');
      params.push(status);
    }

    if (category) {
      whereParts.push('category LIKE ?');
      params.push(`%${category}%`);
    }

    if (search) {
      whereParts.push('(name LIKE ? OR email LIKE ? OR phone LIKE ? OR address LIKE ? OR website LIKE ? OR category LIKE ?)');
      const searchParam = `%${search}%`;
      params.push(searchParam, searchParam, searchParam, searchParam, searchParam, searchParam);
    }

    const whereClause = whereParts.length > 0 ? 'WHERE ' + whereParts.join(' AND ') : '';

    // Validate sortBy to prevent SQL injection
    const validSortColumns: Record<string, string> = {
      name: 'name', email: 'email', phone: 'phone', address: 'address',
      website: 'website', category: 'category', rating: 'rating',
      priorityScore: 'priorityScore', status: 'status',
      createdAt: 'createdAt', updatedAt: 'updatedAt',
    };
    const sortColumn = validSortColumns[sortBy] || 'createdAt';
    const sortDir = sortOrder === 'asc' ? 'ASC' : 'DESC';

    // Get total count
    const countResult = await client.execute({
      sql: `SELECT COUNT(*) as count FROM Lead ${whereClause}`,
      args: params,
    });
    const total = Number(countResult.rows[0]?.count || 0);

    // Get leads
    const leadsResult = await client.execute({
      sql: `SELECT * FROM Lead ${whereClause} ORDER BY ${sortColumn} ${sortDir} LIMIT ? OFFSET ?`,
      args: [...params, limit, offset],
    });

    const leads = leadsResult.rows.map(row => ({
      id: row.id,
      name: row.name,
      address: row.address || '',
      phone: row.phone || '',
      website: row.website || '',
      email: row.email || '',
      rating: row.rating || '',
      reviewsCount: row.reviewsCount || '',
      category: row.category || '',
      source: row.source || 'Google Maps',
      sourceUrl: row.sourceUrl || '',
      priorityScore: Number(row.priorityScore) || 0,
      notes: row.notes || '',
      status: row.status || 'new',
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));

    return NextResponse.json({
      success: true,
      leads,
      count: total,
      page,
      limit,
    });
  } catch (error) {
    console.error('Error fetching leads:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { success: false, error: message },
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

    const client = getLibsqlClient();
    const created: any[] = [];
    const skipped: any[] = [];

    for (const lead of leads) {
      // Check if lead already exists (by email or name+phone combo)
      let existingCheck: any;
      if (lead.email) {
        const result = await client.execute({
          sql: 'SELECT id FROM Lead WHERE email = ? LIMIT 1',
          args: [lead.email],
        });
        existingCheck = result.rows[0];
      }
      if (!existingCheck && lead.name) {
        const result = await client.execute({
          sql: 'SELECT id FROM Lead WHERE name = ? AND phone = ? LIMIT 1',
          args: [lead.name, lead.phone || ''],
        });
        existingCheck = result.rows[0];
      }

      if (existingCheck) {
        skipped.push({ name: lead.name, email: lead.email, phone: lead.phone, reason: 'duplicate' });
        continue;
      }

      const now = new Date().toISOString();
      const id = `lead_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      await client.execute({
        sql: `INSERT INTO Lead (id, name, address, phone, website, email, rating, reviewsCount, category, source, sourceUrl, priorityScore, notes, status, createdAt, updatedAt)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          id, lead.name || '', lead.address || '', lead.phone || '',
          lead.website || '', lead.email || '', lead.rating || '',
          lead.reviews_count || lead.reviewsCount || '', lead.category || '',
          lead.source || 'Google Maps', lead.source_url || lead.sourceUrl || '',
          lead.priority_score || lead.priorityScore || 0, lead.notes || '',
          'new', now, now,
        ],
      });

      created.push({ id, ...lead });
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
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { success: false, error: message },
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

    const client = getLibsqlClient();
    const placeholders = ids.map(() => '?').join(',');
    const result = await client.execute({
      sql: `DELETE FROM Lead WHERE id IN (${placeholders})`,
      args: ids,
    });

    return NextResponse.json({
      success: true,
      deleted: Number(result.rowsAffected || 0),
    });
  } catch (error) {
    console.error('Error deleting leads:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { success: false, error: message },
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

    const client = getLibsqlClient();

    // Build SET clause dynamically
    const validFields = ['name', 'address', 'phone', 'website', 'email', 'rating',
      'reviewsCount', 'category', 'source', 'sourceUrl', 'priorityScore', 'notes', 'status'];
    const setParts: string[] = [];
    const args: any[] = [];

    for (const [key, value] of Object.entries(data)) {
      if (validFields.includes(key)) {
        setParts.push(`${key} = ?`);
        args.push(value);
      }
    }

    if (setParts.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No valid fields to update' },
        { status: 400 }
      );
    }

    setParts.push('updatedAt = ?');
    args.push(new Date().toISOString());
    args.push(id);

    await client.execute({
      sql: `UPDATE Lead SET ${setParts.join(', ')} WHERE id = ?`,
      args,
    });

    // Fetch updated lead
    const result = await client.execute({
      sql: 'SELECT * FROM Lead WHERE id = ? LIMIT 1',
      args: [id],
    });

    const lead = result.rows[0] || { id };

    return NextResponse.json({
      success: true,
      lead,
    });
  } catch (error) {
    console.error('Error updating lead:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
