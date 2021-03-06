import React from 'react';
import { graphql } from 'react-apollo';
import update from 'immutability-helper';
import { filter } from 'graphql-anywhere';
import { withRouter } from 'react-router';

import RepoInfo from '../components/RepoInfo';
import Comment from '../components/Comment';

import SUBSCRIPTION_QUERY from '../graphql/CommentSubscription.graphql';
import SUBMIT_COMMENT_MUTATION from '../graphql/SubmitComment.graphql';
import COMMENT_QUERY from '../graphql/Comment.graphql';

// helper function checks for duplicate comments, which we receive because we
// get subscription updates for our own comments as well.
// TODO it's pretty inefficient to scan all the comments every time.
// maybe only scan the first 10, or up to a certain timestamp
function isDuplicateComment(newComment, existingComments) {
  return newComment.id !== null && existingComments.some(comment => newComment.id === comment.id);
}

class CommentsPage extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      errors: false,
      canSubmit: true,
    };
    this.submitForm = this.submitForm.bind(this);

    // keep track of subscription handle to not subscribe twice.
    // we don't need to unsubscribe on unmount, because the subscription
    // gets stopped when the query stops.
    this.subscription = null;
  }

  componentWillReceiveProps(nextProps) {
    // we don't resubscribe on changed props, because it never happens in our app
    if (!this.subscription && !nextProps.loading) {
      this.subscription = this.props.subscribeToMore({
        document: SUBSCRIPTION_QUERY,
        variables: { repoFullName: nextProps.entry.repository.full_name },
        updateQuery: (previousResult, { subscriptionData }) => {
          const newComment = subscriptionData.data.commentAdded;
          // if it's our own mutation, we might get the subscription result
          // after the mutation result.
          if (isDuplicateComment(newComment, previousResult.entry.comments)) {
            return previousResult;
          }
          const newResult = update(previousResult, {
            entry: {
              comments: {
                $unshift: [newComment],
              },
            },
          });
          return newResult;
        },
      });
    }
  }

  submitForm(event) {
    event.preventDefault();
    const { entry, currentUser, submit } = this.props;

    const repoFullName = entry.repository.full_name;
    const commentContent = this.newCommentInput.value;

    if (commentContent) {
      this.setState({ canSubmit: false });

      submit({
        repoFullName,
        commentContent,
        currentUser,
      }).then((res) => {
        this.setState({ canSubmit: true });

        if (!res.errors) {
          this.newCommentInput.value = '';
        } else {
          this.setState({ errors: res.errors });
        }
      });
    }
  }

  render() {
    const { loading, currentUser, entry } = this.props;
    const { errors, canSubmit } = this.state;

    if (loading) {
      return <div>Loading...</div>;
    }

    const repository = entry.repository;

    return (
      <div>
        <div>
          <h1>Comments for <a href={repository.html_url}>{repository.full_name}</a></h1>
          <RepoInfo entry={filter(RepoInfo.fragments.entry, entry)} />
          {currentUser ? <form onSubmit={this.submitForm}>
            <div className="form-group">

              <input
                type="text"
                className="form-control"
                ref={input => (this.newCommentInput = input)}
                placeholder="Write your comment here!"
              />
            </div>

            {errors && (
              <div className="alert alert-danger" role="alert">
                {errors[0].message}
              </div>
            )}

            <button type="submit" disabled={!canSubmit} className="btn btn-primary">
              Submit
            </button>
          </form> : <div><em>Log in to comment.</em></div>}
        </div>
        <br />
        <div>
          <div>
            {entry.comments
              .filter(comment => comment && comment.postedBy)
              .map(comment => (
                <Comment
                  key={comment.postedBy.login + comment.createdAt + repository.full_name}
                  username={comment.postedBy.login}
                  content={comment.content}
                  createdAt={comment.createdAt}
                  userUrl={comment.postedBy.html_url}
                />
            ))}
          </div>
        </div>
      </div>
    );
  }
}

CommentsPage.propTypes = {
  loading: React.PropTypes.bool.isRequired,
  currentUser: React.PropTypes.shape({
    login: React.PropTypes.string,
  }),
  entry: React.PropTypes.shape({
    id: React.PropTypes.number,
    comments: React.PropTypes.arrayOf(
      React.PropTypes.shape({
        postedBy: React.PropTypes.shape({
          login: React.PropTypes.string.isRequired,
        }),
        createdAt: React.PropTypes.number,
        content: React.PropTypes.string.isRequired,
      })
    ),
    repository: React.PropTypes.shape({
      full_name: React.PropTypes.string,
      html_url: React.PropTypes.string,
    }),
  }),
  submit: React.PropTypes.func.isRequired,
  subscribeToMore: React.PropTypes.func,
};

const withMutations = graphql(SUBMIT_COMMENT_MUTATION, {
  props: ({ ownProps, mutate }) => ({
    submit: ({ repoFullName, commentContent }) =>
      mutate({
        variables: { repoFullName, commentContent },
        optimisticResponse: {
          __typename: 'Mutation',
          submitComment: {
            __typename: 'Comment',
            id: null,
            postedBy: ownProps.currentUser,
            createdAt: +new Date(),
            content: commentContent,
          },
        },
        updateQueries: {
          Comment: (prev, { mutationResult }) => {
            const newComment = mutationResult.data.submitComment;
            if (isDuplicateComment(newComment, prev.entry.comments)) {
              return prev;
            }
            return update(prev, {
              entry: {
                comments: {
                  $unshift: [newComment],
                },
              },
            });
          },
        },
      }),
  }),
});

const withData = graphql(COMMENT_QUERY, {
  options: ({ match }) => ({
    variables: { repoName: `${match.params.org}/${match.params.repoName}` },
  }),
  props: ({ data: { loading, currentUser, entry, subscribeToMore } }) => ({
    loading, currentUser, entry, subscribeToMore,
  }),
});

export default withRouter(withData(withMutations(CommentsPage)));
