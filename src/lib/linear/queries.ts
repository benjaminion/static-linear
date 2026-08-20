export const INITIATIVE_BODY_QUERY = /* GraphQL */ `
  query InitiativeBody($id: String!) {
    initiative(id: $id) {
      id
      name
      description
      content
    }
  }
`;

export const DOCUMENT_EXPORT_QUERY = /* GraphQL */ `
  query ExportLinearDocument($id: String!) {
    document(id: $id) {
      id
      title
      content
      slugId
      url
      archivedAt
      updatedAt
      sortOrder
    }
  }
`;

export const INITIATIVE_QUERY = /* GraphQL */ `
  query PublicInitiative($id: String!, $after: String) {
    initiative(id: $id) {
      id
      name
      url
      description
      content
      status
      health
      targetDate
      lastUpdate { id body createdAt health user { id name } }
      organization { urlKey }
      projects(first: 50, after: $after, includeArchived: true, includeSubInitiatives: false) {
        nodes {
          id
          name
          slugId
          url
          description
          content
          health
          startDate
          targetDate
          completedAt
          canceledAt
          lead { id name }
          status { name type color }
          lastUpdate { id body createdAt health user { id name } }
          projectMilestones(first: 50, includeArchived: true) {
            nodes { id name description targetDate }
            pageInfo { hasNextPage endCursor }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

export const INITIATIVE_RESOURCES_QUERY = /* GraphQL */ `
  query PublicInitiativeResources($id: String!) {
    initiative(id: $id) {
      documents(first: 50, includeArchived: false) {
        nodes { id title content slugId url archivedAt updatedAt sortOrder }
        pageInfo { hasNextPage endCursor }
      }
      links(first: 50, includeArchived: false) {
        nodes { id label url archivedAt sortOrder }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

export const PROJECT_RESOURCES_QUERY = /* GraphQL */ `
  query PublicProjectResources($id: String!) {
    project(id: $id) {
      documents(first: 50, includeArchived: false) {
        nodes { id title content slugId url archivedAt updatedAt sortOrder }
        pageInfo { hasNextPage endCursor }
      }
      externalLinks(first: 50, includeArchived: false) {
        nodes { id label url archivedAt sortOrder }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

export const INITIATIVE_DOCUMENTS_QUERY = /* GraphQL */ `
  query PublicInitiativeDocuments($id: String!, $after: String) {
    initiative(id: $id) {
      documents(first: 50, after: $after, includeArchived: false) {
        nodes { id title content slugId url archivedAt updatedAt sortOrder }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

export const INITIATIVE_LINKS_QUERY = /* GraphQL */ `
  query PublicInitiativeLinks($id: String!, $after: String) {
    initiative(id: $id) {
      links(first: 50, after: $after, includeArchived: false) {
        nodes { id label url archivedAt sortOrder }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

export const PROJECT_DOCUMENTS_QUERY = /* GraphQL */ `
  query PublicProjectDocuments($id: String!, $after: String) {
    project(id: $id) {
      documents(first: 50, after: $after, includeArchived: false) {
        nodes { id title content slugId url archivedAt updatedAt sortOrder }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

export const PROJECT_LINKS_QUERY = /* GraphQL */ `
  query PublicProjectLinks($id: String!, $after: String) {
    project(id: $id) {
      externalLinks(first: 50, after: $after, includeArchived: false) {
        nodes { id label url archivedAt sortOrder }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

export const PROJECT_MILESTONES_QUERY = /* GraphQL */ `
  query PublicProjectMilestones($id: String!, $after: String) {
    project(id: $id) {
      projectMilestones(first: 50, after: $after, includeArchived: true) {
        nodes { id name description targetDate }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

export const ISSUES_QUERY = /* GraphQL */ `
  query PublicIssues($projectIds: [ID!]!, $after: String) {
    issues(
      first: 20
      after: $after
      includeArchived: false
      filter: { project: { id: { in: $projectIds } } }
      orderBy: updatedAt
    ) {
      nodes {
        id
        identifier
        title
        url
        description
        priority
        priorityLabel
        estimate
        dueDate
        createdAt
        updatedAt
        completedAt
        canceledAt
        archivedAt
        project { id }
        parent { id }
        state { name type color }
        assignee { id name }
        labels(first: 50) {
          nodes { id name color }
          pageInfo { hasNextPage endCursor }
        }
        comments(first: 20, includeArchived: true) {
          nodes {
            id
            body
            createdAt
            updatedAt
            user { id name }
          }
          pageInfo { hasNextPage endCursor }
        }
        relations(first: 20, includeArchived: true) {
          nodes {
            id
            type
            issue { id }
            relatedIssue { id }
          }
          pageInfo { hasNextPage endCursor }
        }
        inverseRelations(first: 20, includeArchived: true) {
          nodes {
            id
            type
            issue { id }
            relatedIssue { id }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export const ISSUE_DETAIL_PAGE_QUERY = /* GraphQL */ `
  query PublicIssueDetailPage(
    $id: String!
    $commentsAfter: String
    $relationsAfter: String
    $inverseAfter: String
    $labelsAfter: String
  ) {
    issue(id: $id) {
      comments(first: 50, after: $commentsAfter, includeArchived: true) {
        nodes { id body createdAt updatedAt user { id name } }
        pageInfo { hasNextPage endCursor }
      }
      relations(first: 50, after: $relationsAfter, includeArchived: true) {
        nodes { id type issue { id } relatedIssue { id } }
        pageInfo { hasNextPage endCursor }
      }
      inverseRelations(first: 50, after: $inverseAfter, includeArchived: true) {
        nodes { id type issue { id } relatedIssue { id } }
        pageInfo { hasNextPage endCursor }
      }
      labels(first: 50, after: $labelsAfter) {
        nodes { id name color }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;
